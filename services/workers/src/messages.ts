import {
  checkpointSchema,
  digestSchema,
  evidenceBundleSchema,
  signedBidSchema,
  taskManifestSchema,
} from "@backstop/shared";
import { z } from "zod";

export const workerEventSchema = z.object({
  taskId: z.string(),
  version: z.int(),
  body: z.discriminatedUnion("type", [
    z.object({ type: z.literal("guarantee_posted") }),
    z.object({ type: z.literal("recovery_opened"), epoch: z.int() }),
    z.object({ type: z.literal("coalition_proposed"), bid: signedBidSchema }),
    z.object({
      type: z.literal("attempt_assigned"),
      attempt: z.int(),
      epoch: z.int(),
      bid: signedBidSchema,
    }),
    z.object({
      type: z.literal("verification_recorded"),
      evidence: evidenceBundleSchema,
      challengeDeadlineMs: z.int().nullable(),
    }),
    z.object({ type: z.literal("attempt_failed"), attempt: z.int(), reason: z.string() }),
    z.object({
      type: z.literal("attempt_rejected"),
      attempt: z.int(),
      reason: z.string(),
      ruling: z.object({ expected: z.json(), actual: z.json() }).nullable(),
    }),
    z.object({ type: z.literal("task_settled") }),
  ]),
});
export type WorkerEvent = z.infer<typeof workerEventSchema>;

export const snapshotSchema = z.object({
  task: z.object({
    state: z.string(),
    version: z.int(),
    attempt: z.int(),
    manifest: taskManifestSchema,
    excludedAgents: z.array(z.string()),
    checkpoints: z.array(z.object({ checkpoint: checkpointSchema, hash: digestSchema })),
  }),
});
export type Snapshot = z.infer<typeof snapshotSchema>["task"];

export const leaseReplySchema = z.object({
  events: z.array(
    z.object({
      body: z.object({ type: z.string(), lease: z.object({ fencingToken: z.int() }).optional() }),
    }),
  ),
});

export const artifactReplySchema = z.object({ source: z.string() });
