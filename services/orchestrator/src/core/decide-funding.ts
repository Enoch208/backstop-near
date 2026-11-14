import {
  fail,
  fromYocto,
  manifestHash,
  pendingEndorsers,
  succeed,
  taskManifestSchema,
  toYocto,
  type SignedBid,
  type TaskManifest,
} from "@backstop/shared";
import type { Decision, DecisionContext } from "./commands.js";
import type { TaskRecord } from "./record.js";
import { checkSignedBid } from "./signed-bid.js";

export function decideCreate(record: TaskRecord | null, manifest: TaskManifest): Decision {
  if (record !== null) return fail("DUPLICATE", `Task ${record.taskId} already exists`);
  const parsed = taskManifestSchema.safeParse(manifest);
  if (!parsed.success) return fail("INVALID_SCHEMA", parsed.error.message);
  return succeed([
    { type: "task_created", manifest: parsed.data, manifestHash: manifestHash(parsed.data) },
  ]);
}

export function decideDeposit(
  record: TaskRecord,
  pool: "escrow" | "premium",
  amount: bigint,
  reference: string,
): Decision {
  if (record.attempt > 0) return fail("POLICY_VIOLATION", "Funding closes at the first assignment");
  if (amount <= 0n) return fail("POLICY_VIOLATION", "A deposit must be positive");
  return succeed([{ type: "funds_deposited", pool, amountYocto: toYocto(amount), reference }]);
}

export function decideGuarantee(
  record: TaskRecord,
  guarantor: string,
  bond: bigint,
  liability: bigint,
  reference: string,
): Decision {
  const terms = record.manifest.guarantee;
  if (terms === null) return fail("POLICY_VIOLATION", "This task has no guarantee terms");
  if (record.state !== "FUNDED")
    return fail("INVALID_TRANSITION", `A guarantee cannot be posted in ${record.state}`);
  if (guarantor === record.manifest.owner) {
    return fail("POLICY_VIOLATION", "The customer cannot guarantee their own task");
  }
  if (liability !== fromYocto(terms.maxLiabilityYocto)) {
    return fail("POLICY_VIOLATION", "The liability must match the funded guarantee terms");
  }
  if (bond < liability) return fail("LIABILITY_EXCEEDED", "Coverage can never exceed the bond");
  return succeed([
    {
      type: "guarantee_posted",
      guarantor,
      bondYocto: toYocto(bond),
      liabilityYocto: toYocto(liability),
      reference,
    },
  ]);
}

export function decideAssignPrimary(
  record: TaskRecord,
  signed: SignedBid,
  context: DecisionContext,
): Decision {
  const ready = record.manifest.guarantee === null ? "FUNDED" : "BONDED";
  if (record.state !== ready) {
    return fail("INVALID_TRANSITION", `The primary is assigned from ${ready}, not ${record.state}`);
  }
  const checked = checkSignedBid(record, signed, context.registry);
  if (!checked.ok) return checked;
  if (checked.value.bid.purpose === "standby")
    return fail("POLICY_VIOLATION", "A standby bid cannot assign the primary");
  if (signed.bid.members.some(({ agentId }) => context.busyAgents?.has(agentId)))
    return fail("POLICY_VIOLATION", "A worker is committed to another task");
  if (checked.value.bid.epoch !== 0) return fail("POLICY_VIOLATION", "The primary bid is epoch 0");
  if (pendingEndorsers(checked.value).length > 0) {
    return fail("POLICY_VIOLATION", "Every member of a primary coalition must endorse it first");
  }
  if (fromYocto(checked.value.bid.amountYocto) > record.ledger.available.escrow) {
    return fail("BUDGET_EXCEEDED", "The primary is paid from customer escrow only");
  }
  return succeed([
    {
      type: "attempt_assigned",
      attempt: 1,
      epoch: 0,
      bid: checked.value,
      claimByMs: context.nowMs + record.manifest.policy.leaseMs,
    },
  ]);
}
