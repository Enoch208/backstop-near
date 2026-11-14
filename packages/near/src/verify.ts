import type { JsonRpcProvider } from "near-api-js";
import { z } from "zod";
import { readOutcome } from "./outcome.js";
import { ledgerViewSchema } from "./wire.js";

const stepSchema = z.object({
  label: z.string(),
  txHash: z.string(),
  outcome: z.string(),
  signer: z.string().optional(),
});

export const testnetRecordSchema = z.object({
  contractId: z.string(),
  deployTx: z.string().nullable(),
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
