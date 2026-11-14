import type { JsonRpcProvider } from "near-api-js";
import { z } from "zod";
import { readOutcome } from "./outcome.js";
import { teeSignerSchema } from "./tee.js";
import { ledgerViewSchema } from "./wire.js";

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

export const testnetRecordSchema = z.object({
  contractId: z.string(),
  deployTx: z.string().nullable(),
  upgrades: z.array(upgradeSchema).default([]),
  teeSigners: z.array(signerRecordSchema).default([]),
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
  provider: JsonRpcProvider,
  step: z.infer<typeof stepSchema>,
  root: string,
): Promise<Finding> {
  const response = await provider.viewTransactionStatus({
    txHash: step.txHash,
    accountId: signerOf(step, root),
    waitUntil: "FINAL",
  });
  const call = readOutcome(response);
  const observed = call.ok ? "success" : `refused ${call.errorCode ?? ""}`.trim();
  return {
    ok: observed === step.outcome,
    subject: step.txHash,
    detail: `${step.label}: recorded ${step.outcome}, chain says ${observed}`,
  };
}

export async function verifyLedger(
  provider: JsonRpcProvider,
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
  provider: JsonRpcProvider,
  contractId: string,
  recorded: z.infer<typeof signerRecordSchema>,
  latest: boolean,
): Promise<Finding> {
  const raw = await provider.callFunction({
    contractId,
    method: "get_tee_signer",
    args: { address: recorded.signingAddress },
  });
  const onChain = teeSignerSchema.nullable().parse(raw ?? null);
  const hash = recorded.attestationHash.replace(/^sha256:/, "");
  const matches = onChain?.model === recorded.model && onChain.attestation_hash === hash;
  return {
    ok: latest ? matches : onChain?.model === recorded.model,
    subject: recorded.signingAddress,
    detail: `${recorded.signingAddress} is registered on chain for ${recorded.model}${latest ? ` with attestation ${hash.slice(0, 12)}...` : ""}${onChain === null ? " (MISSING)" : ""}`,
  };
}
