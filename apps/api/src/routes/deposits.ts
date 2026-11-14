import { digestSchema, fromYocto, yoctoSchema } from "@backstop/shared";
import { chainDeposit, chainGuarantee } from "@backstop/near";
import { decide, type TaskRecord } from "@backstop/orchestrator";
import { z } from "zod";
import { keepReply, signedWrite, type Authenticated, type HandlerResult } from "../auth.js";
import { chainOperation, record as recordStep } from "../chain.js";
import { failure, type ApiError } from "../http.js";
import { atomic, execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const fundBody = z.strictObject({
  pool: z.enum(["escrow", "premium", "bond"]),
  amountYocto: yoctoSchema,
  liabilityYocto: yoctoSchema.nullable(),
});

type Funding =
  | { kind: "deposit"; pool: "escrow" | "premium"; amount: bigint; reference: string }
  | {
      kind: "postGuarantee";
      guarantor: string;
      bond: bigint;
      liability: bigint;
      reference: string;
    };

const pendingFundingSchema = z.strictObject({
  actor: z.string(),
  key: z.string(),
  fingerprint: digestSchema,
  taskId: z.string(),
  pool: fundBody.shape.pool,
  amount: yoctoSchema,
  liability: yoctoSchema.nullable(),
  account: z.string(),
});
type PendingFunding = z.infer<typeof pendingFundingSchema>;

const fundingPrefix = "funding:";

function commandFor(pending: PendingFunding, reference: string): Funding {
  const amount = fromYocto(pending.amount);
  return pending.pool === "bond"
    ? {
        kind: "postGuarantee",
        guarantor: pending.account,
        bond: amount,
        liability: fromYocto(pending.liability ?? pending.amount),
        reference,
      }
    : { kind: "deposit", pool: pending.pool, amount, reference };
}

async function onChain(
  runtime: Runtime,
  record: TaskRecord,
  pending: PendingFunding,
): Promise<string | ApiError> {
  const bridge = runtime.chain;
  if (bridge === null) throw new Error("Cannot recover NEAR funding without the vault");
  const funding = commandFor(pending, "");
  const step = await chainOperation(runtime, bridge, fundingPrefix + pending.key, () =>
    funding.kind === "deposit"
      ? chainDeposit(
          bridge.parties,
          record,
          funding.pool,
          funding.amount,
          record.ledger.inflow.escrow === 0n,
        )
      : chainGuarantee(bridge.parties, record, funding.bond, funding.liability),
  );
  recordStep(bridge, record.taskId, step, true);
  return step.call.ok
    ? `near:${step.call.txHash}`
    : failure(
        "POLICY_VIOLATION",
        `NEAR refused it: ${step.call.errorCode ?? "unknown"} (${step.call.txHash})`,
      );
}

function finishFunding(
  runtime: Runtime,
  pending: PendingFunding,
  settled: string | ApiError,
): HandlerResult {
  const { taskId, actor } = pending;
  if (typeof settled !== "string") return refuse(runtime, taskId, settled);
  const result = execute(runtime, taskId, actor, commandFor(pending, settled));
  if (!result.ok && runtime.chain !== null)
    throw new Error(
      `NEAR accepted funding for ${taskId} but the task rejected it: ${result.failure.message}`,
    );
  return fromOutcome(runtime, taskId, result);
}

function clearFunding(runtime: Runtime, pending: PendingFunding): void {
  runtime.persistence?.del(fundingPrefix + pending.taskId);
  runtime.persistence?.del(`near-tx:${fundingPrefix}${pending.key}`);
  runtime.pendingFunding.delete(pending.taskId);
}

export async function recoverFunding(runtime: Runtime): Promise<void> {
  const persisted = runtime.persistence?.list(fundingPrefix, pendingFundingSchema) ?? [];
  if (persisted.length > 0 && runtime.chain === null)
    throw new Error("Configure the original NEAR vault before restoring pending chain funding");
  for (const { value: pending } of persisted) {
    if (runtime.inflight.has(pending.key)) continue;
    const record = runtime.store.records[pending.taskId];
    if (record === undefined) throw new Error(`Missing funded task ${pending.taskId}`);
    runtime.pendingFunding.add(pending.taskId);
    const settled = await onChain(runtime, record, pending);
    atomic(runtime, () => {
      keepReply(runtime, pending, finishFunding(runtime, pending, settled), crypto.randomUUID());
      clearFunding(runtime, pending);
    });
  }
}

function startFunding(
  runtime: Runtime,
  record: TaskRecord,
  pending: PendingFunding,
): Promise<() => HandlerResult> {
  runtime.pendingFunding.add(record.taskId);
  runtime.persistence?.set(fundingPrefix + record.taskId, pending);
  return onChain(runtime, record, pending).then(
    (settled) => () => {
      const result = finishFunding(runtime, pending, settled);
      clearFunding(runtime, pending);
      return result;
    },
    (error: unknown) => {
      if (runtime.persistence === null) runtime.pendingFunding.delete(record.taskId);
      throw error;
    },
  );
}

function authorizeFunding(
  runtime: Runtime,
  record: TaskRecord,
  actor: Authenticated["actor"],
  pool: PendingFunding["pool"],
): ApiError | null {
  const isBond = pool === "bond";
  if (!isBond && actor.account !== record.manifest.owner)
    return failure("UNAUTHORIZED", "Only the customer funds escrow and premium");
  if (runtime.chain !== null && actor.id !== (isBond ? "guarantor" : "customer"))
    return failure("UNAUTHORIZED", "Only the configured funding principal can spend NEAR");
  if (runtime.pendingFunding.has(record.taskId))
    return failure("STALE_STATE", "A NEAR funding action is awaiting confirmation");
  return null;
}

export function fund(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body, key, fingerprint }) => {
    const parsed = parseBody(fundBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const record = runtime.store.records[taskId];
    if (record === undefined)
      return refuse(runtime, taskId, failure("NOT_FOUND", `No task ${taskId}`));
    const { pool, amountYocto, liabilityYocto } = parsed.value;
    const unauthorized = authorizeFunding(runtime, record, actor, pool);
    if (unauthorized !== null) return refuse(runtime, taskId, unauthorized);
    const pending: PendingFunding = {
      actor: actor.id,
      key,
      fingerprint,
      taskId,
      pool,
      amount: amountYocto,
      liability: liabilityYocto,
      account: actor.account,
    };
    const command = commandFor(pending, `fixture-vault:${actor.id}:${pool}`);
    const check = decide(record, command, { nowMs: runtime.now(), registry: runtime.registry });
    if (!check.ok)
      return refuse(runtime, taskId, failure(check.failure.code, check.failure.message));
    return runtime.chain === null
      ? fromOutcome(runtime, taskId, execute(runtime, taskId, actor.id, command))
      : startFunding(runtime, record, pending);
  });
}
