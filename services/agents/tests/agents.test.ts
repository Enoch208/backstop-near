import { describe, expect, it } from "vitest";
import { bidSchema, fromYocto, near, verifyValue } from "@backstop/shared";
import { candidate, checkoutSuite } from "@backstop/fixture-checkout";
import { fixtureBids, roster, searchCounterexample, workFor } from "../src/index.js";

const context = {
  taskId: "checkout-001",
  epoch: 1,
  nowMs: 0,
  bidWindowMs: 10_000,
  excludedAgents: [],
};

const targetFor = (name: "beta-boundary" | "gamma-integer") => {
  const artifact = candidate(name);
  return {
    taskId: "checkout-001",
    attempt: 2,
    artifactHash: artifact.artifactHash,
    artifactSource: artifact.source,
    suite: checkoutSuite,
  };
};

describe("fixture bidders", () => {
  it("FR-010 three separately identified offers bid, each signed by its lead", () => {
    const bids = fixtureBids(context);
    expect(bids).toHaveLength(3);
    expect(new Set(bids.map((signed) => signed.bid.members[0]?.agentId)).size).toBe(3);
    for (const signed of bids) {
      expect(bidSchema.safeParse(signed.bid).success).toBe(true);
      expect(verifyValue(signed.bid, signed.signature)).toBe(true);
    }
  });

  it("forms a two-agent coalition whose shares add up to its 0.52 NEAR bid", () => {
    const coalition = fixtureBids(context).find((signed) => signed.bid.members.length === 2);
    expect(coalition && fromYocto(coalition.bid.amountYocto)).toBe(near("0.52"));
    expect(coalition?.bid.members.map((member) => member.role)).toEqual([
      "repairer",
      "diagnostician",
    ]);
  });

  it("drops an agent the market has excluded", () => {
    const bids = fixtureBids({ ...context, excludedAgents: [roster.beta.agentId] });
    expect(
      bids.some((signed) => signed.bid.members.some((member) => member.agentId === "beta")),
    ).toBe(false);
  });
});

describe("fixture work", () => {
  it("leaves the primary's work unfinished and gives each repairer its own artifact", () => {
    expect(workFor("alpha").plan.completes).toBe(false);
    expect(workFor("beta").artifact.name).toBe("beta-boundary");
    expect(workFor("gamma").artifact.name).toBe("gamma-integer");
  });
});

describe("the challenger", () => {
  it("finds the free-shipping boundary bug in the patch the suite passed, reproducibly", () => {
    const first = searchCounterexample(targetFor("beta-boundary"), "kappa", 7);
    const second = searchCounterexample(targetFor("beta-boundary"), "kappa", 7);
    expect(first.ruling?.upheld).toBe(true);
    expect(first.input?.lines[0]?.unitPriceCents).toBe(first.input?.freeShippingThresholdCents);
    expect(second).toEqual(first);
  });

  it("finds nothing against the correct repair within its budget", () => {
    const search = searchCounterexample(targetFor("gamma-integer"), "kappa", 7, 120);
    expect(search.ruling).toBeNull();
    expect(search.probes).toBe(120);
  });
});
