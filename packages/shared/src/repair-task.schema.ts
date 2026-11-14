import { z } from "zod";
import { canonicalJson, utf8Length } from "./canonical.js";
import { suiteCaseSchema, testSuiteSchema } from "./suite.schema.js";

export const repairRunnerId = "quickjs-wasm-0.32.0-json-v1";

const sourceSchema = z.string().min(1).max(64_000);
const rulesSchema = z.string().min(1).max(8_000);
const inputSchema = z.json().refine((input) => utf8Length(canonicalJson(input)) <= 16_000);
const repairCaseSchema = suiteCaseSchema.extend({ input: inputSchema, expected: inputSchema });
const repairSuiteSchema = testSuiteSchema.extend({
  oracleSource: sourceSchema,
  cases: z.array(repairCaseSchema).min(2).max(32),
});
const milestoneSchema = z.strictObject({
  objective: z.string().min(1).max(500),
  rules: rulesSchema,
  publicCaseIds: z.array(suiteCaseSchema.shape.id).min(1).max(32),
});

export const repairTaskSchema = z
  .strictObject({
    objective: z.string().min(1).max(500),
    rules: rulesSchema,
    source: sourceSchema,
    suite: repairSuiteSchema,
    challengeInputs: z.array(inputSchema).max(16).exactOptional(),
    primaryMilestone: milestoneSchema.exactOptional(),
  })
  .superRefine((task, ctx) => {
    if (utf8Length(JSON.stringify(task)) > 200_000) {
      ctx.addIssue({ code: "custom", message: "The repair task exceeds 200 KB" });
    }
    const cases = task.suite.cases;
    if (!cases.some((testCase) => testCase.visibility === "public")) {
      ctx.addIssue({ code: "custom", message: "At least one public case is required" });
    }
    const hidden = cases.filter((testCase) => testCase.visibility === "held_out");
    if (hidden.length === 0) {
      ctx.addIssue({ code: "custom", message: "At least one held-out case is required" });
    }
    if (new Set(cases.map((testCase) => testCase.id)).size !== cases.length) {
      ctx.addIssue({ code: "custom", message: "Case IDs must be distinct" });
    }
    const publicInputs = new Set([
      ...cases
        .filter((testCase) => testCase.visibility === "public")
        .map((testCase) => canonicalJson(testCase.input)),
      ...(task.challengeInputs ?? []).map(canonicalJson),
    ]);
    if (hidden.some((testCase) => publicInputs.has(canonicalJson(testCase.input)))) {
      ctx.addIssue({
        code: "custom",
        message: "Held-out inputs must differ from public and challenge inputs",
      });
    }
    const milestone = task.primaryMilestone;
    if (milestone !== undefined) {
      const testIds = new Set(
        cases.filter((testCase) => testCase.visibility === "public").map((testCase) => testCase.id),
      );
      if (new Set(milestone.publicCaseIds).size !== milestone.publicCaseIds.length) {
        ctx.addIssue({ code: "custom", message: "Milestone case IDs must be distinct" });
      }
      if (milestone.publicCaseIds.some((id) => !testIds.has(id))) {
        ctx.addIssue({ code: "custom", message: "Milestone cases must be public cases" });
      }
      if ((task.challengeInputs?.length ?? 0) === 0) {
        ctx.addIssue({ code: "custom", message: "A primary milestone requires a challenge probe" });
      }
    }
  });

export type RepairTask = z.infer<typeof repairTaskSchema>;

export const repairBriefSchema = z.strictObject({
  source: sourceSchema,
  rules: rulesSchema,
  suite: repairSuiteSchema.omit({ oracleSource: true }),
  probes: z.array(z.strictObject({ input: inputSchema, expected: inputSchema })).max(16),
  primaryMilestone: milestoneSchema.exactOptional(),
});

export type RepairTaskBrief = z.infer<typeof repairBriefSchema>;
