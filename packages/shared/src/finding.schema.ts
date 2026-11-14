import { z } from "zod";
import { digestOf, type Digest } from "./canonical.js";

export const failingCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  input: z.json(),
  expected: z.json(),
  actual: z.json(),
});
export type FailingCase = z.infer<typeof failingCaseSchema>;

export const findingSchema = z.strictObject({
  failingCases: z.array(failingCaseSchema).max(32),
  notes: z.string().max(2_000),
});
export type Finding = z.infer<typeof findingSchema>;

export function findingHash(finding: Finding): Digest {
  return digestOf(finding);
}
