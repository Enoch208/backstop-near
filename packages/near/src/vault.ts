import { Account, actions, teraToGas, type Action } from "near-api-js";
import type { z } from "zod";
import { readOutcome, type ChainCall } from "./outcome.js";
import { ledgerViewSchema, rolesSchema, transferViewSchema, type Hex32 } from "./wire.js";

export type Vault = {
  readonly contractId: string;
  readonly send?: (signer: Account, actions: Action[]) => Promise<ChainCall>;
};

export const defaultGas = teraToGas("30");
export const settlementGas = teraToGas("300");

export async function callVault(
  vault: Vault,
  signer: Account,
  method: string,
  args: Record<string, unknown>,
  options: { deposit?: bigint; gas?: bigint } = {},
): Promise<ChainCall> {
  const calls = [
    actions.functionCall(method, args, options.gas ?? defaultGas, options.deposit ?? 0n),
  ];
  if (vault.send !== undefined) return vault.send(signer, calls);
  const response = await signer.signAndSendTransaction({
    receiverId: vault.contractId,
    actions: calls,
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  return readOutcome(response);
}

async function view<T>(
  vault: Vault,
  reader: Account,
  method: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
) {
  const result = await reader.provider.callFunction({
    contractId: vault.contractId,
    method,
    args,
    blockQuery: { finality: "final" },
  });
  return schema.nullable().parse(result ?? null);
}

export const getLedger = (vault: Vault, reader: Account, taskId: string) =>
  view(vault, reader, "get_ledger", { task_id: taskId }, ledgerViewSchema);

export const getTransfer = (vault: Vault, reader: Account, transferId: string) =>
  view(vault, reader, "get_transfer", { transfer_id: transferId }, transferViewSchema);

export const getRoles = (vault: Vault, reader: Account) =>
  view(vault, reader, "get_roles", {}, rolesSchema);

export type VaultPolicy = {
  readonly deadlineNs: bigint;
  readonly maxAttempts: number;
  readonly compensationCap: bigint;
};

export const createTask = (
  vault: Vault,
  customer: Account,
  taskId: string,
  manifestHash: Hex32,
  policy: VaultPolicy,
  escrow: bigint,
) =>
  callVault(
    vault,
    customer,
    "create_task",
    {
      task_id: taskId,
      manifest_hash: manifestHash,
      policy: {
        deadline_ns: policy.deadlineNs.toString(),
        max_attempts: policy.maxAttempts,
        compensation_cap: policy.compensationCap.toString(),
      },
    },
    { deposit: escrow },
  );

export const fundPremium = (vault: Vault, customer: Account, taskId: string, premium: bigint) =>
  callVault(vault, customer, "fund_premium", { task_id: taskId }, { deposit: premium });

export const postGuarantee = (
  vault: Vault,
  guarantor: Account,
  taskId: string,
  bond: bigint,
  liability: bigint,
) =>
  callVault(
    vault,
    guarantor,
    "post_guarantee",
    { task_id: taskId, max_liability: liability.toString() },
    { deposit: bond },
  );

export type ChainAssignment = {
  readonly attempt: number;
  readonly agent: string;
  readonly bidHash: Hex32;
  readonly payees: readonly { account: string; amount: bigint }[];
};

export const registerAssignment = (
  vault: Vault,
  coordinator: Account,
  taskId: string,
  assignment: ChainAssignment,
) =>
  callVault(vault, coordinator, "register_assignment", {
    task_id: taskId,
    attempt: assignment.attempt,
    agent: assignment.agent,
    bid_hash: assignment.bidHash,
    amount: assignment.payees.reduce((total, payee) => total + payee.amount, 0n).toString(),
    payees: assignment.payees.map((payee) => [payee.account, payee.amount.toString()]),
  });

export const openRecovery = (
  vault: Vault,
  coordinator: Account,
  taskId: string,
  failureCode: string,
) => callVault(vault, coordinator, "open_recovery", { task_id: taskId, failure_code: failureCode });

export type ChainVerdict = {
  readonly attempt: number;
  readonly artifactHash: Hex32;
  readonly suiteHash: Hex32;
  readonly evidenceHash: Hex32;
  readonly outcome: "ACCEPT" | "REJECT";
};

export const recordVerdict = (
  vault: Vault,
  verifier: Account,
  taskId: string,
  verdict: ChainVerdict,
) =>
  callVault(vault, verifier, "record_verdict", {
    task_id: taskId,
    attempt: verdict.attempt,
    artifact_hash: verdict.artifactHash,
    suite_hash: verdict.suiteHash,
    evidence_hash: verdict.evidenceHash,
    outcome: verdict.outcome,
  });

export const finalizeSuccess = (vault: Vault, caller: Account, taskId: string) =>
  callVault(vault, caller, "finalize_success", { task_id: taskId }, { gas: settlementGas });

export const finalizeFailure = (vault: Vault, caller: Account, taskId: string) =>
  callVault(vault, caller, "finalize_failure", { task_id: taskId }, { gas: settlementGas });

export const retryFailedTransfer = (vault: Vault, caller: Account, transferId: string) =>
  callVault(
    vault,
    caller,
    "retry_failed_transfer",
    { transfer_id: transferId },
    { gas: teraToGas("100") },
  );
