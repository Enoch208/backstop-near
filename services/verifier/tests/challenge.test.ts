import { describe, expect, it } from "vitest";
import { candidate, checkoutSuite } from "@backstop/fixture-checkout";
import { judgeChallenge } from "../src/index.js";
import { exactThresholdOrder } from "./support.js";

const challenge = (name: "beta-boundary" | "gamma-integer", input: unknown) => {
  const artifact = candidate(name);
  return judgeChallenge({
    taskId: "checkout-001",
    attempt: 2,
    artifactHash: artifact.artifactHash,
    artifactSource: artifact.source,
    suite: checkoutSuite,
    input,
    challenger: "kappa",
  });
};

describe("judgeChallenge", () => {
  it("TC-006 upholds a reproducible counterexample against a superficially passing patch", () => {
    const ruling = challenge("beta-boundary", exactThresholdOrder);
    expect(ruling.upheld).toBe(true);
    expect(ruling.expected).toMatchObject({ shippingCents: 0, totalCents: 10_000 });
    expect(ruling.actual).toMatchObject({ shippingCents: 999, totalCents: 10_999 });
  });

  it("dismisses the same input against a correct patch", () => {
    expect(challenge("gamma-integer", exactThresholdOrder).upheld).toBe(false);
  });

  it("dismisses an input outside the specification, where the oracle itself fails", () => {
    expect(challenge("beta-boundary", { lines: "not a list" }).upheld).toBe(false);
  });
});
