import { z } from "zod";
import { yoctoSchema } from "./amount.js";
import { digestOf, digestSchema, type Digest } from "./canonical.js";
import { nearAccountSchema, taskIdSchema } from "./ids.js";

export const manifestVersion = "backstop-manifest-1";

export const toolIds = ["read_workspace", "write_patch", "run_public_tests"] as const;

export const taskPolicySchema = z.strictObject({
  maxAttempts: z.int().min(1).max(10),
  leaseMs: z.int().min(1_000),
  heartbeatGraceMs: z.int().min(0),
  bidWindowMs: z.int().min(1_000),
  challengeWindowMs: z.int().min(1_000),
});
export type TaskPolicy = z.infer<typeof taskPolicySchema>;

export const guaranteeTermsSchema = z.strictObject({
  maxLiabilityYocto: yoctoSchema,
  compensationCapYocto: yoctoSchema,
});
export type GuaranteeTerms = z.infer<typeof guaranteeTermsSchema>;

export const taskManifestSchema = z.strictObject({
  version: z.literal(manifestVersion),
  taskId: taskIdSchema,
  owner: nearAccountSchema,
  objective: z.string().min(1).max(500),
  suite: z.strictObject({
    suiteId: z.string().min(1).max(64),
    suiteHash: digestSchema,
    runnerId: z.string().min(1).max(64),
  }),
  allowedTools: z.array(z.enum(toolIds)).min(1),
  deadlineMs: z.int().min(0),
  budget: z.strictObject({ escrowYocto: yoctoSchema, premiumYocto: yoctoSchema }),
  guarantee: guaranteeTermsSchema.nullable(),
  policy: taskPolicySchema,
});
export type TaskManifest = z.infer<typeof taskManifestSchema>;

export function manifestHash(manifest: TaskManifest): Digest {
  return digestOf(manifest);
}
