import type { Provider } from "near-api-js";
import { z } from "zod";
import { vaultMethods, type RestrictedRole } from "./keys.js";
import { defaultTestnetRpc } from "./network.js";
import { readFinalOutcome } from "./journal.js";
import { teeSignerSchema } from "./tee.js";
import { matchesTeeRegistration } from "./tee-registration.js";
import { ledgerViewSchema } from "./wire.js";
import { ProofProvider } from "./proof-provider.js";

export function testnetProofProvider(url?: string): Provider {
  return new ProofProvider(
    url === undefined
      ? [defaultTestnetRpc, "https://api.zan.top/near-testnet", "https://testnet-rpc.intea.rs"]
      : [url],
  );
}

const stepSchema = z.object({
  label: z.string(),
  txHash: z.string(),
  outcome: z.string(),
  signer: z.string().optional(),
});

const upgradeSchema = z.object({ txHash: z.string(), from: z.string(), to: z.string() });
const signerRecordSchema = z.object({
  txHash: z.string(),
  model: z.string(),
  signingAddress: z.string(),
  attestationHash: z.string(),
});

const restrictionSchema = z.object({
  txHash: z.string(),
  account: z.string(),
  role: z.enum(["coordinator", "verifier", "owner"]),
});

export const testnetRecordSchema = z.object({
  contractId: z.string(),
  deployTx: z.string().nullable(),
  upgrades: z.array(upgradeSchema).default([]),
  teeSigners: z.array(signerRecordSchema).default([]),
  keyRestrictions: z.array(restrictionSchema).default([]),
  runs: z.array(z.object({ taskId: z.string(), steps: z.array(stepSchema) })),
});
export type TestnetRecord = z.infer<typeof testnetRecordSchema>;

export type Finding = { readonly ok: boolean; readonly subject: string; readonly detail: string };

const roles = ["customer", "guarantor", "coordinator", "verifier"] as const;

export function signerOf(step: z.infer<typeof stepSchema>, root: string): string {
  if (step.signer !== undefined) return step.signer;
  const role = roles.find((name) => step.label.toLowerCase().startsWith(name)) ?? "coordinator";
  return `${role}.${root}`;
}

export async function verifyStep(
  provider: Provider,
  step: z.infer<typeof stepSchema>,
  root: string,
): Promise<Finding> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const response = await provider.viewTransactionStatus({
    txHash: step.txHash,
    accountId: signerOf(step, root),
    waitUntil: "FINAL",
  });
  const call = readFinalOutcome(response);
  const observed = call.ok ? "success" : `refused ${call.errorCode ?? ""}`.trim();
  return {
    ok:
      call.txHash === step.txHash &&
      call.signer === signerOf(step, root) &&
      observed === step.outcome,
    subject: step.txHash,
    detail: `${step.label}: recorded ${step.outcome}, chain says ${observed}`,
  };
}

export async function verifyLedger(
  provider: Provider,
  contractId: string,
  taskId: string,
): Promise<Finding> {
  const raw = await provider.callFunction({
    contractId,
    method: "get_ledger",
    args: { task_id: taskId },
  });
  const ledger = ledgerViewSchema.nullable().parse(raw ?? null);
  if (ledger === null) return { ok: false, subject: taskId, detail: "no ledger on chain" };
  const settled = ledger.state === "SETTLED" || ledger.state === "FAILURE_SETTLED";
  const balanced = ledger.total_inflow === ledger.confirmed_outflow;
  const clear = ledger.pending_outflow === "0" && ledger.failed_outflow === "0";
  return {
    ok: settled && balanced && clear,
    subject: taskId,
    detail: `${ledger.state}, in ${ledger.total_inflow}, confirmed out ${ledger.confirmed_outflow}, pending ${ledger.pending_outflow}, failed ${ledger.failed_outflow}`,
  };
}

export async function verifyTeeSigner(
  provider: Provider,
  contractId: string,
  recorded: z.infer<typeof signerRecordSchema>,
  latest: boolean,
): Promise<Finding> {
  const registration = await provider.viewTransactionStatus({
    txHash: recorded.txHash,
    accountId: contractId,
    waitUntil: "FINAL",
  });
  const historical = matchesTeeRegistration(registration, contractId, recorded);
  const raw = latest
    ? await provider.callFunction({
        contractId,
        method: "get_tee_signer",
        args: { address: recorded.signingAddress },
      })
    : null;
  const current = teeSignerSchema.nullable().parse(raw ?? null);
  const hash = recorded.attestationHash.replace(/^sha256:/, "");
  return {
    ok: historical && (!latest || current?.model === recorded.model),
    subject: recorded.signingAddress,
    detail: `${recorded.signingAddress}: finalized registration ${recorded.txHash} ${historical ? "matches" : "DOES NOT MATCH"} model ${recorded.model} and attestation ${hash.slice(0, 12)}...${latest ? `; current model authorization ${current?.model === recorded.model ? "confirmed" : "MISSING OR CHANGED"}` : ""}`,
  };
}

const permissionSchema = z.union([
  z.literal("FullAccess"),
  z.object({
    FunctionCall: z.object({ receiver_id: z.string(), method_names: z.array(z.string()) }),
  }),
]);

export async function verifyRestriction(
  provider: Provider,
  contractId: string,
  account: string,
  role: RestrictedRole,
): Promise<Finding> {
  const list = await provider.viewAccessKeyList({ accountId: account });
  const permissions = list.keys.map((key) => permissionSchema.parse(key.access_key.permission));
  const allowed = new Set<string>(vaultMethods[role]);
  const restricted =
    permissions.length > 0 &&
    permissions.every(
      (permission) =>
        permission !== "FullAccess" &&
        permission.FunctionCall.receiver_id === contractId &&
        permission.FunctionCall.method_names.length > 0 &&
        permission.FunctionCall.method_names.every((method) => allowed.has(method)),
    );
  return {
    ok: restricted,
    subject: account,
    detail: `${account} holds ${String(permissions.length)} key(s), ${restricted ? `all restricted to ${role} calls on ${contractId}` : "key scopes do not establish the expected restrictions"}`,
  };
}
