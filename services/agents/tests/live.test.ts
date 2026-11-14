import { describe, expect, it } from "vitest";
import { checkoutRules, checkoutSuite, candidate } from "@backstop/fixture-checkout";
import { canonicalJson } from "@backstop/shared";
import { extractSource, modelFromEnv, repairPrompt, type RepairBrief } from "../src/index.js";

const brief: RepairBrief = {
  objective: "Repair checkoutTotal.",
  rules: checkoutRules,
  brokenSource: candidate("original").source,
  resumedFrom: null,
  suite: checkoutSuite,
  validatedSubtasks: ["discount-before-tax"],
  failureHistory: ["attempt 1 failed: LEASE_EXPIRED"],
  diagnosis: null,
};

const boundary = {
  id: "probe-8",
  input: { lines: [{ sku: "edge", unitPriceCents: 5_000, quantity: 1 }] },
  expected: { shippingCents: 0 },
  actual: { shippingCents: 999 },
};

describe("the live repair prompt", () => {
  it("shows the model the public examples and never a held-out case", () => {
    const prompt = repairPrompt(brief)
      .map((message) => message.content)
      .join("\n");
    const publicIds = checkoutSuite.cases.filter((testCase) => testCase.visibility === "public");
    const heldOut = checkoutSuite.cases.filter((testCase) => testCase.visibility === "held_out");
    expect(publicIds.length).toBeGreaterThan(0);
    for (const testCase of heldOut) {
      expect(prompt).not.toContain(canonicalJson(testCase.input));
      expect(prompt).not.toContain(testCase.id);
    }
    for (const testCase of publicIds) expect(prompt).toContain(canonicalJson(testCase.input));
    expect(prompt).toContain("discount-before-tax");
    expect(prompt).toContain(checkoutRules);
    expect(prompt).toContain("LEASE_EXPIRED");
    expect(prompt).toContain(candidate("original").source.trim());
  });

  it("adds a coalition partner's diagnosis only when one was consumed", () => {
    const text = (diagnosis: RepairBrief["diagnosis"]) =>
      repairPrompt({ ...brief, diagnosis })
        .map((message) => message.content)
        .join("\n");
    expect(text(null)).not.toContain("Diagnosis from");
    const diagnosed = text({
      from: "delta",
      finding: { failingCases: [boundary], notes: "3 of 4 public cases pass" },
    });
    expect(diagnosed).toContain("Diagnosis from delta");
    expect(diagnosed).toContain("3 of 4 public cases pass");
    expect(diagnosed).toContain(canonicalJson([boundary]));
  });

  it("takes only the fenced code from a reply", () => {
    expect(extractSource("Here:\n```js\nfunction checkoutTotal() { return 1; }\n```\nDone")).toBe(
      "function checkoutTotal() { return 1; }\n",
    );
    expect(extractSource("no code here")).toBeNull();
  });

  it("stays off without a key, and defaults to NEAR AI Cloud with one", () => {
    expect(modelFromEnv({})).toBeNull();
    expect(modelFromEnv({ BACKSTOP_AI_API_KEY: "test-key" })).toMatchObject({
      baseUrl: "https://cloud-api.near.ai/v1",
      apiKey: "test-key",
    });
  });
});
