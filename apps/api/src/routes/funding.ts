import {
  digestSchema,
  fromYocto,
  leadAgent,
  signatureSchema,
  signedBidSchema,
  taskManifestSchema,
  yoctoSchema,
} from "@backstop/shared";
import { z } from "zod";
import { signedWrite } from "../auth.js";
import { failure, type ApiError } from "../http.js";
import { record as recordStep } from "../chain.js";
import { chainDeposit, chainGuarantee } from "@backstop/near";
import { decide, type TaskRecord } from "@backstop/orchestrator";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const createBody = z.strictObject({ manifest: taskManifestSchema });
const fundBody = z.strictObject({
  pool: z.enum(["escrow", "premium", "bond"]),
  amountYocto: yoctoSchema,
  liabilityYocto: yoctoSchema.nullable(),
});
const bidBody = z.strictObject({ bid: signedBidSchema });
const endorseBody = z.strictObject({ bidHash: digestSchema, signature: signatureSchema });

export function createTask(runtime: Runtime, request: Request): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(createBody, body);
    if (!parsed.ok) return { error: parsed.error, taskVersion: null };
    const { manifest } = parsed.value;
    if (manifest.owner !== actor.account) {
      return refuse(
        runtime,
        manifest.taskId,
        failure("UNAUTHORIZED", "Only the manifest owner creates the task"),
      );
    }
    return fromOutcome(
      runtime,
      manifest.taskId,
      execute(runtime, manifest.taskId, actor.id, { kind: "create", manifest }),
      201,
    );
  });
}

type Funding =
  | { kind: "deposit"; pool: "escrow" | "premium"; amount: bigint; reference: string }
  | {
      kind: "postGuarantee";
      guarantor: string;
      bond: bigint;
      liability: bigint;
      reference: string;
    };

async function onChain(
  runtime: Runtime,
  record: TaskRecord,
  funding: Funding,
): Promise<string | ApiError> {
  const bridge = runtime.chain;
  if (bridge === null) return funding.reference;
  const step =
    funding.kind === "deposit"
      ? await chainDeposit(
          bridge.parties,
          record,
          funding.pool,
          funding.amount,
          record.ledger.inflow.escrow === 0n,
        )
      : await chainGuarantee(bridge.parties, record, funding.bond, funding.liability);
  recordStep(bridge, record.taskId, step, true);
  return step.call.ok
    ? `near:${step.call.txHash}`
    : failure(
        "POLICY_VIOLATION",
        `NEAR refused it: ${step.call.errorCode ?? "unknown"} (${step.call.txHash})`,
      );
}

export function fund(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, async ({ actor, body }) => {
    const parsed = parseBody(fundBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const record = runtime.store.records[taskId];
    if (record === undefined)
      return refuse(runtime, taskId, failure("NOT_FOUND", `No task ${taskId}`));
    const amount = fromYocto(parsed.value.amountYocto);
    const reference = `fixture-vault:${actor.id}:${parsed.value.pool}`;
    if (parsed.value.pool !== "bond" && actor.account !== record.manifest.owner) {
      return refuse(
        runtime,
        taskId,
        failure("UNAUTHORIZED", "Only the customer funds escrow and premium"),
      );
    }
    const funding: Funding =
      parsed.value.pool === "bond"
        ? {
            kind: "postGuarantee",
            guarantor: actor.account,
            bond: amount,
            liability:
              parsed.value.liabilityYocto === null
                ? amount
                : fromYocto(parsed.value.liabilityYocto),
            reference,
          }
        : { kind: "deposit", pool: parsed.value.pool, amount, reference };
    const check = decide(record, funding, { nowMs: runtime.now(), registry: runtime.registry });
    if (!check.ok)
      return refuse(runtime, taskId, failure(check.failure.code, check.failure.message));
    const settled = await onChain(runtime, record, funding);
    if (typeof settled !== "string") return refuse(runtime, taskId, settled);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, { ...funding, reference: settled }),
    );
  });
}

export function bid(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(bidBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const signed = parsed.value.bid;
    if (leadAgent(signed.bid) !== actor.id) {
      return refuse(
        runtime,
        taskId,
        failure("UNAUTHORIZED", "A bid is submitted by its lead agent"),
      );
    }
    const state = runtime.store.records[taskId]?.state;
    if (signed.bid.epoch === 0 && (state === "FUNDED" || state === "BONDED")) {
      return fromOutcome(
        runtime,
        taskId,
        execute(runtime, taskId, "coordinator", { kind: "assignPrimary", bid: signed }),
      );
    }
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, { kind: "bid", bid: signed }),
    );
  });
}

export function endorse(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(endorseBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "endorse",
        bidHash: parsed.value.bidHash,
        endorsement: { agentId: actor.id, signature: parsed.value.signature },
      }),
    );
  });
}
