import { describe, expect, it } from "vitest";
import { isAuthenticEvidence } from "@backstop/shared";
import { verifyArtifact } from "../src/index.js";
import { requestFor, verifierKey } from "./support.js";

describe("verifyArtifact on the checkout suite", () => {
  it("TC-005 rejects the broken original and the partial patch", () => {
    const original = verifyArtifact(requestFor("original"));
    const partial = verifyArtifact(requestFor("alpha-partial"));
    expect(original.body.verdict).toBe("REJECT");
    expect(partial.body.verdict).toBe("REJECT");
    expect(partial.body.checks.find((item) => item.id === "half-cent-tax-rounds-up")?.status).toBe(
      "fail",
    );
  });

  it("accepts the integer repair on every public and held-out case", () => {
    const evidence = verifyArtifact(requestFor("gamma-integer"));
    expect(evidence.body.verdict).toBe("ACCEPT");
    expect(evidence.body.totals).toEqual({ passed: 8, failed: 0 });
  });

  it("passes the boundary patch, because the pinned suite never probes the exact threshold", () => {
    expect(verifyArtifact(requestFor("beta-boundary")).body.verdict).toBe("ACCEPT");
  });

  it("is reproducible: the same artifact yields the same evidence hash and signature", () => {
    const first = verifyArtifact(requestFor("gamma-integer"));
    const second = verifyArtifact(requestFor("gamma-integer"));
    expect(second).toEqual(first);
  });

  it("TC-012 rejects tampered evidence and evidence signed by another key", () => {
    const evidence = verifyArtifact(requestFor("beta-boundary"));
    expect(isAuthenticEvidence(evidence, verifierKey.publicKey)).toBe(true);
    const tampered = { ...evidence, body: { ...evidence.body, attempt: 3 } };
    expect(isAuthenticEvidence(tampered, verifierKey.publicKey)).toBe(false);
    expect(isAuthenticEvidence(evidence, "0".repeat(64))).toBe(false);
  });
});
