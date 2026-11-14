import { describe, expect, it } from "vitest";
import { checkoutSuite, candidate } from "@backstop/fixture-checkout";
import { canonicalJson } from "@backstop/shared";
import { extractSource, modelFromEnv, repairPrompt } from "../src/index.js";

const brief = {
  objective: "Repair checkoutTotal.",
  brokenSource: candidate("original").source,
  suite: checkoutSuite,
  validatedSubtasks: ["discount-before-tax"],
  failureHistory: ["attempt 1 failed: LEASE_EXPIRED"],
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
    expect(prompt).toContain("LEASE_EXPIRED");
    expect(prompt).toContain(candidate("original").source.trim());
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
