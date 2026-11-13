import { describe, expect, it } from "vitest";
import { taskManifestSchema, testSuiteSchema } from "@backstop/shared";
import {
  candidate,
  candidateNames,
  checkoutManifest,
  checkoutSuite,
  checkoutSuiteHash,
} from "../src/index.js";

describe("the checkout fixture", () => {
  it("pins a valid suite with public and held-out cases", () => {
    expect(testSuiteSchema.safeParse(checkoutSuite).success).toBe(true);
    const visibilities = new Set(checkoutSuite.cases.map((testCase) => testCase.visibility));
    expect(visibilities).toEqual(new Set(["public", "held_out"]));
    expect(checkoutSuiteHash).toMatch(/^sha256:/);
  });

  it("gives every candidate a content-addressed artifact hash", () => {
    const hashes = candidateNames.map((name) => candidate(name).artifactHash);
    expect(new Set(hashes).size).toBe(candidateNames.length);
  });

  it("builds a manifest bound to the suite hash", () => {
    const manifest = checkoutManifest({ taskId: "checkout-001", createdAtMs: 0, maxAttempts: 3 });
    expect(taskManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.suite.suiteHash).toBe(checkoutSuiteHash);
  });
});
