import { z } from "zod";
import { digestOf, digestSchema, type Digest } from "./canonical.js";
import { nearAccountSchema, taskIdSchema } from "./ids.js";
import { signatureSchema } from "./signing.js";
import { caseVisibilities } from "./suite.schema.js";

export const verdicts = ["ACCEPT", "REJECT"] as const;
export type VerdictOutcome = (typeof verdicts)[number];

export const checkResultSchema = z.strictObject({
  id: z.string().min(1).max(48),
  visibility: z.enum(caseVisibilities),
  status: z.enum(["pass", "fail", "error"]),
  detail: z.string().max(240).nullable(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const attestedInferenceSchema = z.strictObject({
  provider: z.literal("near-ai-cloud"),
  model: z.string().min(1).max(128),
  chatId: z.string().min(1).max(256),
  signingAddress: z.string().regex(/^0x[0-9a-f]{40}$/),
  requestHash: digestSchema,
  responseHash: digestSchema,
  signedText: z.string().min(1).max(512),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});
export type AttestedInference = z.infer<typeof attestedInferenceSchema>;

export const evidenceBodySchema = z.strictObject({
  version: z.literal("backstop-evidence-1"),
  taskId: taskIdSchema,
  attempt: z.int().min(1),
  fencingToken: z.int().min(1),
  policyHash: digestSchema,
  artifactHash: digestSchema,
  suiteHash: digestSchema,
  runnerId: z.string().min(1).max(64),
  checks: z.array(checkResultSchema).min(1),
  totals: z.strictObject({ passed: z.int().min(0), failed: z.int().min(0) }),
  verdict: z.enum(verdicts),
  verifierAccount: nearAccountSchema,
  inference: attestedInferenceSchema.optional(),
});
export type EvidenceBody = z.infer<typeof evidenceBodySchema>;

export const evidenceBundleSchema = z.strictObject({
  body: evidenceBodySchema,
  evidenceHash: digestSchema,
  signature: signatureSchema,
});
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export function evidenceHash(body: EvidenceBody): Digest {
  return digestOf(body);
}

export const challengeRulingSchema = z.strictObject({
  taskId: taskIdSchema,
  attempt: z.int().min(1),
  artifactHash: digestSchema,
  reproducerHash: digestSchema,
  upheld: z.boolean(),
  expected: z.json(),
  actual: z.json(),
  challenger: z.string().min(1).max(48),
});
export type ChallengeRuling = z.infer<typeof challengeRulingSchema>;

export const signedChallengeRulingSchema = z.strictObject({
  ruling: challengeRulingSchema,
  signature: signatureSchema,
});
export type SignedChallengeRuling = z.infer<typeof signedChallengeRulingSchema>;
