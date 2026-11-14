import { z } from "zod";
import { digestOf, type Digest } from "./canonical.js";

export const caseVisibilities = ["public", "held_out"] as const;

export const suiteCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  visibility: z.enum(caseVisibilities),
  input: z.json(),
  expected: z.json(),
});
export type SuiteCase = z.infer<typeof suiteCaseSchema>;

export const testSuiteSchema = z.strictObject({
  suiteId: z.string().min(1).max(64),
  entry: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  oracleSource: z.string().min(1),
  cases: z.array(suiteCaseSchema).min(1),
});
export type TestSuite = z.infer<typeof testSuiteSchema>;

export function suiteHash(suite: TestSuite): Digest {
  return digestOf(suite);
}

export function publicView<Suite extends Pick<TestSuite, "cases">>(suite: Suite): Suite {
  return { ...suite, cases: suite.cases.filter((testCase) => testCase.visibility === "public") };
}
