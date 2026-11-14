import { Account, actions, teraToGas, type Action } from "near-api-js";
import type { z } from "zod";
import { readOutcome, type ChainCall } from "./outcome.js";
import { ledgerViewSchema, rolesSchema, transferViewSchema, type Hex32 } from "./wire.js";

export type Vault = {
  readonly contractId: string;
  readonly token?: { readonly contractId: string; readonly unitsPerBaseUnit: bigint };
  readonly send?: (signer: Account, actions: Action[], receiverId: string) => Promise<ChainCall>;
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
  if (vault.send !== undefined) return vault.send(signer, calls, vault.contractId);
  const response = await signer.signAndSendTransaction({
    receiverId: vault.contractId,
    actions: calls,
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  return readOutcome(response);
}

export function fitsToken(vault: Vault, value: bigint): boolean {
  const scale = vault.token?.unitsPerBaseUnit ?? 1n;
  return scale > 0n && value % scale === 0n;
}

export function tokenAmount(vault: Vault, value: bigint): bigint {
  if (!fitsToken(vault, value))
    throw new Error(
      "The task amount cannot be represented exactly in the vault token's base units",
    );
  return value / (vault.token?.unitsPerBaseUnit ?? 1n);
}

async function fundPool(
  vault: Vault,
  signer: Account,
  method: string,
  operation: string,
  args: Record<string, unknown>,
  amount: bigint,
): Promise<ChainCall> {
  if (vault.token === undefined) return callVault(vault, signer, method, args, { deposit: amount });
  const amountText = tokenAmount(vault, amount).toString();
  const receiverId = vault.token.contractId;
  const calls = [
    actions.functionCall(
      "ft_transfer_call",
      {
        receiver_id: vault.contractId,
        amount: amountText,
        msg: JSON.stringify({ operation, ...args }),
      },
      teraToGas("130"),
      1n,
    ),
  ];
  const result =
    vault.send !== undefined
      ? await vault.send(signer, calls, receiverId)
      : readOutcome(
          await signer.signAndSendTransaction({
            receiverId,
            actions: calls,
            waitUntil: "FINAL",
            throwOnFailure: false,
          }),
        );
  if (!result.ok) return result;
  const expectedEvent = operation === "guarantee" ? "guarantee_posted" : "task_funded";
  return result.vaultEvents?.[vault.contractId]?.some(
    ({ event, data }) => event === expectedEvent && data.task_id === args.task_id,
  )
    ? result
    : { ...result, ok: false, errorCode: "ERR_TOKEN_FUNDING_REFUNDED" };
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
  fundPool(
    vault,
    customer,
    "create_task",
    "create",
    {
      task_id: taskId,
      manifest_hash: manifestHash,
      policy: {
        deadline_ns: policy.deadlineNs.toString(),
        max_attempts: policy.maxAttempts,
        compensation_cap: tokenAmount(vault, policy.compensationCap).toString(),
      },
    },
    escrow,
  );

export const fundTask = (vault: Vault, customer: Account, taskId: string, escrow: bigint) =>
  fundPool(vault, customer, "fund_task", "escrow", { task_id: taskId }, escrow);

export const fundPremium = (vault: Vault, customer: Account, taskId: string, premium: bigint) =>
  fundPool(vault, customer, "fund_premium", "premium", { task_id: taskId }, premium);

export const postGuarantee = (
  vault: Vault,
  guarantor: Account,
  taskId: string,
  bond: bigint,
  liability: bigint,
) =>
  fundPool(
    vault,
    guarantor,
    "post_guarantee",
    "guarantee",
    { task_id: taskId, max_liability: tokenAmount(vault, liability).toString() },
    bond,
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
    amount: tokenAmount(
      vault,
      assignment.payees.reduce((total, payee) => total + payee.amount, 0n),
    ).toString(),
    payees: assignment.payees.map((payee) => [
      payee.account,
      tokenAmount(vault, payee.amount).toString(),
    ]),
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
