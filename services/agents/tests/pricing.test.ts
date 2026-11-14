import { describe, expect, it } from "vitest";
import {
  bidSchema,
  failureReasons,
  formatNear,
  near,
  sumYocto,
  verifyValue,
  type FailureReason,
} from "@backstop/shared";
import {
  decideToJoin,
  priceRecovery,
  pricedBid,
  pricingProfile,
  recoveryTeam,
  roster,
  type Market,
  type PricedAgent,
  type Quote,
} from "../src/index.js";

const teamOf = (leadId: string): readonly PricedAgent[] => {
  const found = recoveryTeam(leadId);
  if (found === null) throw new RangeError(`no team for ${leadId}`);
  return found.team;
};

const firstEpoch: Market = {
  budgetYocto: near("0.65"),
  epoch: 1,
  failures: ["LEASE_EXPIRED"],
  failingCases: 1,
  publicCases: 4,
  msLeft: 29 * 60_000,
};

const secondEpoch: Market = {
  ...firstEpoch,
  epoch: 2,
  failures: ["LEASE_EXPIRED", "CHALLENGE_UPHELD"],
  failingCases: 0,
};

const amount = (quote: Quote) => (quote.kind === "offer" ? quote.amountYocto : null);
const shares = (quote: Quote) =>
  quote.kind === "offer"
    ? Object.fromEntries(quote.members.map((m) => [m.agent.agentId, formatNear(m.shareYocto)]))
    : null;

const roomy: PricedAgent = {
  agent: roster.gamma,
  profile: { ...pricingProfile("gamma"), capacityUnits: 100, riskAppetiteBps: 1_000_000 },
};

describe("recovery pricing", () => {
  it("prices the first recovery epoch: beta cheapest, the coalition dearer, epsilon capped", () => {
    expect(shares(priceRecovery(teamOf("beta"), firstEpoch))).toEqual({ beta: "0.25" });
    expect(shares(priceRecovery(teamOf("gamma"), firstEpoch))).toEqual({
      gamma: "0.4",
      delta: "0.2",
    });
    const epsilon = priceRecovery(teamOf("epsilon"), firstEpoch);
    expect(amount(epsilon)).toBe(near("0.65"));
    expect(epsilon.reasoning.at(-1)).toBe(
      "asks 0.75 NEAR but 0.65 NEAR is left: markups scaled down to bid 0.65 NEAR",
    );
  });

  it("prices in a challenger's upheld counterexample after beta's patch is broken", () => {
    const coalition = priceRecovery(teamOf("gamma"), secondEpoch);
    expect(shares(coalition)).toEqual({ gamma: "0.36", delta: "0.18" });
    expect(coalition.reasoning[0]).toBe(
      "epoch 2: 2 failed attempts so far (LEASE_EXPIRED +25%, CHALLENGE_UPHELD +100%), risk loading 125%",
    );
    const epsilon = priceRecovery(teamOf("epsilon"), secondEpoch);
    expect(epsilon).toMatchObject({
      kind: "decline",
      reason: "125% risk is above epsilon's 50% appetite",
    });
  });

  it("charges more for more failing cases, never less", () => {
    const prices = [0, 1, 2, 3, 4].map((failingCases) =>
      amount(priceRecovery([roomy], { ...firstEpoch, budgetYocto: near("100"), failingCases })),
    );
    for (const [index, price] of prices.entries()) {
      if (index > 0) expect(price ?? 0n).toBeGreaterThan(prices[index - 1] ?? 0n);
    }
  });

  it("charges more after every kind of failed attempt, never less", () => {
    const base = { ...firstEpoch, budgetYocto: near("100"), failures: [] };
    const clean = amount(priceRecovery([roomy], base)) ?? 0n;
    for (const reason of failureReasons) {
      const failures: FailureReason[] = [reason];
      const riskier = amount(priceRecovery([roomy], { ...base, failures })) ?? 0n;
      expect(riskier).toBeGreaterThan(clean);
      const worse = amount(priceRecovery([roomy], { ...base, failures: [...failures, reason] }));
      expect(worse ?? 0n).toBeGreaterThan(riskier);
    }
  });

  it("never bids above the remaining budget, and declines only when its floor is above it", () => {
    for (const leadId of ["beta", "gamma", "epsilon"]) {
      const team = teamOf(leadId);
      const floor = sumYocto(team.map(({ profile }) => profile.floorPerUnitYocto * 2n));
      for (let cents = 0n; cents <= 120n; cents += 1n) {
        const budgetYocto = near("0.01") * cents + 7n;
        const quote = priceRecovery(team, { ...firstEpoch, budgetYocto });
        if (floor > budgetYocto) expect(quote.kind).toBe("decline");
        else expect(amount(quote) ?? budgetYocto + 1n).toBeLessThanOrEqual(budgetYocto);
      }
    }
    expect(priceRecovery(teamOf("gamma"), { ...firstEpoch, budgetYocto: near("0.47") })).toEqual(
      expect.objectContaining({
        kind: "decline",
        reason: "its floor of 0.48 NEAR is above the 0.47 NEAR left in escrow plus liability",
      }),
    );
  });

  it("declines work beyond its capacity, past its appetite or too close to the deadline", () => {
    expect(priceRecovery(teamOf("beta"), { ...firstEpoch, failingCases: 3 })).toMatchObject({
      kind: "decline",
      reason: "beta takes at most 3 units and this needs 4",
    });
    const shaky: FailureReason[] = ["CHALLENGE_UPHELD", "CHALLENGE_UPHELD"];
    expect(priceRecovery(teamOf("gamma"), { ...firstEpoch, failures: shaky })).toMatchObject({
      kind: "decline",
      reason: "200% risk is above gamma's 150% appetite",
    });
    expect(priceRecovery(teamOf("beta"), { ...firstEpoch, msLeft: 39_000 })).toMatchObject({
      kind: "decline",
      reason: "needs about 40 s but 39 s remain before the deadline",
    });
  });

  it("adds a rush premium when the deadline is close but reachable", () => {
    const rushed = priceRecovery(teamOf("beta"), { ...firstEpoch, msLeft: 100_000 });
    expect(amount(rushed)).toBe(near("0.3"));
    expect(rushed.reasoning).toContain("the deadline is close: +25% rush premium");
  });

  it("is deterministic: the same market always yields the same quote", () => {
    for (const market of [firstEpoch, secondEpoch]) {
      expect(priceRecovery(teamOf("gamma"), market)).toEqual(
        priceRecovery(teamOf("gamma"), market),
      );
    }
  });

  it("splits a capped coalition bid into shares that add up exactly, each above its floor", () => {
    for (const budgetYocto of [
      near("0.48"),
      near("0.5") + 1n,
      near("0.555555555555555555555555"),
    ]) {
      const quote = priceRecovery(teamOf("gamma"), { ...firstEpoch, budgetYocto });
      if (quote.kind !== "offer") throw new Error(`expected an offer under ${String(budgetYocto)}`);
      expect(quote.amountYocto).toBe(budgetYocto);
      expect(sumYocto(quote.members.map((member) => member.shareYocto))).toBe(quote.amountYocto);
      for (const member of quote.members) {
        expect(member.shareYocto).toBeGreaterThanOrEqual(
          pricingProfile(member.agent.agentId).floorPerUnitYocto * 2n,
        );
      }
    }
  });

  it("signs a priced coalition bid whose diagnostician seat delta accepts", () => {
    const found = recoveryTeam("gamma");
    const quote = priceRecovery(found?.team ?? [], secondEpoch);
    if (found === null || quote.kind !== "offer") throw new Error("expected a coalition offer");
    const signed = pricedBid(
      { taskId: "checkout-001", epoch: 2, nowMs: 5_000, bidWindowMs: 3_000 },
      found.plan,
      quote,
    );
    expect(bidSchema.safeParse(signed.bid).success).toBe(true);
    expect(verifyValue(signed.bid, signed.signature)).toBe(true);
    expect(signed.bid.amountYocto).toBe(near("0.54").toString());
    expect(signed.bid.estimatedDurationMs).toBe(30_000);
    expect(decideToJoin(roster.delta, signed, ["alpha", "beta"])).toEqual({
      join: true,
      reason: "0.18 NEAR as diagnostician",
    });
  });
});
