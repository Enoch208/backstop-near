import { pools, transferPurposes } from "@backstop/ledger";
import {
  challengeRulingSchema,
  checkpointSchema,
  digestSchema,
  endorsementSchema,
  evidenceBundleSchema,
  failureReasons,
  leaseSchema,
  signedBidSchema,
  taskIdSchema,
  taskManifestSchema,
  yoctoSchema,
} from "@backstop/shared";
import { z } from "zod";

const positive = z.int().positive();
const instant = z.int().nonnegative();
const reason = z.enum(failureReasons);
const agents = z.array(z.string());
const reference = z.string().min(1);
const settlementKind = z.enum(["success", "failure"]);
const leg = z.object({
  recipient: z.string(),
  amountYocto: yoctoSchema,
  pool: z.enum(pools),
  purpose: z.enum(transferPurposes),
});

const eventBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task_created"),
    manifest: taskManifestSchema,
    manifestHash: digestSchema,
  }),
  z.object({
    type: z.literal("funds_deposited"),
    pool: z.enum(["escrow", "premium"]),
    amountYocto: yoctoSchema,
    reference,
  }),
  z.object({
    type: z.literal("guarantee_posted"),
    guarantor: z.string(),
    bondYocto: yoctoSchema,
    liabilityYocto: yoctoSchema,
    reference,
  }),
  z.object({
    type: z.literal("attempt_assigned"),
    attempt: positive,
    epoch: instant,
    bid: signedBidSchema,
    claimByMs: instant,
  }),
  z.object({ type: z.literal("lease_granted"), lease: leaseSchema }),
  z.object({ type: z.literal("heartbeat_recorded"), fencingToken: positive, expiresAtMs: instant }),
  z.object({
    type: z.literal("checkpoint_recorded"),
    checkpoint: checkpointSchema,
    checkpointHash: digestSchema,
  }),
  z.object({
    type: z.literal("artifact_submitted"),
    attempt: positive,
    fencingToken: positive,
    agentId: z.string(),
    artifactHash: digestSchema,
    checkpointHash: digestSchema.nullable(),
  }),
  z.object({
    type: z.literal("finding_recorded"),
    attempt: positive,
    agentId: z.string(),
    findingHash: digestSchema,
    failingCases: z.array(z.string()),
  }),
  z.object({
    type: z.literal("lease_expired"),
    attempt: positive,
    fencingToken: positive.nullable(),
  }),
  z.object({ type: z.literal("attempt_failed"), attempt: positive, reason, agents }),
  z.object({ type: z.literal("recovery_opened"), epoch: positive, reason, closesAtMs: instant }),
  z.object({ type: z.literal("coalition_proposed"), bid: signedBidSchema }),
  z.object({
    type: z.literal("coalition_endorsed"),
    bidHash: digestSchema,
    endorsement: endorsementSchema,
  }),
  z.object({ type: z.literal("bid_submitted"), bid: signedBidSchema }),
  z.object({
    type: z.literal("recovery_awarded"),
    epoch: positive,
    winner: digestSchema,
    rejected: z.array(z.object({ bidHash: digestSchema, reason: z.string() })),
  }),
  z.object({
    type: z.literal("verification_recorded"),
    evidence: evidenceBundleSchema,
    challengeDeadlineMs: instant.nullable(),
  }),
  z.object({ type: z.literal("challenge_dismissed"), ruling: challengeRulingSchema }),
  z.object({
    type: z.literal("attempt_rejected"),
    attempt: positive,
    reason,
    ruling: challengeRulingSchema.nullable(),
    agents,
  }),
  z.object({ type: z.literal("task_accepted"), attempt: positive, evidenceHash: digestSchema }),
  z.object({ type: z.literal("terminal_failure"), reason }),
  z.object({
    type: z.literal("settlement_started"),
    kind: settlementKind,
    attempt: instant,
    settlementKey: digestSchema,
    legs: z.array(leg),
  }),
  z.object({
    type: z.literal("transfer_resolved"),
    transferId: z.string(),
    succeeded: z.boolean(),
  }),
  z.object({ type: z.literal("transfer_retried"), transferId: z.string() }),
  z.object({ type: z.literal("task_settled"), kind: settlementKind, ledgerHash: digestSchema }),
]);

export const taskEventSchema = z.object({
  eventId: reference,
  taskId: taskIdSchema,
  version: positive,
  atMs: instant,
  actor: reference,
  body: eventBody,
});
