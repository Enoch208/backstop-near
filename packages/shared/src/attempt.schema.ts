import { z } from "zod";
import { digestOf, digestSchema, type Digest } from "./canonical.js";
import { agentIdSchema, taskIdSchema } from "./ids.js";

export const leaseSchema = z.strictObject({
  taskId: taskIdSchema,
  attempt: z.int().min(1),
  epoch: z.int().min(0),
  agentId: agentIdSchema,
  fencingToken: z.int().min(1),
  grantedAtMs: z.int().min(0),
  expiresAtMs: z.int().min(0),
});
export type Lease = z.infer<typeof leaseSchema>;

export const checkpointSchema = z.strictObject({
  taskId: taskIdSchema,
  attempt: z.int().min(1),
  stateVersion: z.int().min(0),
  contentHash: digestSchema,
  artifactUri: z.string().min(1).max(256),
  validatedSubtasks: z.array(z.string().min(1).max(64)),
  provenanceEventIds: z.array(z.string().min(1).max(128)),
  parentCheckpointHash: digestSchema.nullable(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

export function checkpointHash(checkpoint: Checkpoint): Digest {
  return digestOf(checkpoint);
}

export const attemptResultSchema = z.strictObject({
  taskId: taskIdSchema,
  attempt: z.int().min(1),
  agentId: agentIdSchema,
  fencingToken: z.int().min(1),
  artifactHash: digestSchema,
  checkpointHash: digestSchema.nullable(),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;
