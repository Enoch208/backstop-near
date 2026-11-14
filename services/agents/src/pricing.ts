import { formatNear, sumYocto, type FailureReason } from "@backstop/shared";
import type { FixtureAgent } from "./roster.js";

export type PricingProfile = {
  readonly floorPerUnitYocto: bigint;
  readonly riskAppetiteBps: number;
  readonly capacityUnits: number;
  readonly msPerUnit: number;
};

export type PricedAgent = { readonly agent: FixtureAgent; readonly profile: PricingProfile };

export type Market = {
  readonly budgetYocto: bigint;
  readonly epoch: number;
  readonly failures: readonly FailureReason[];
  readonly failingCases: number;
  readonly publicCases: number;
  readonly msLeft: number;
  readonly currency?: string;
};

export type PricedShare = { readonly agent: FixtureAgent; readonly shareYocto: bigint };

export type Quote =
  | {
      readonly kind: "offer";
      readonly amountYocto: bigint;
      readonly members: readonly PricedShare[];
      readonly estimatedDurationMs: number;
      readonly reasoning: readonly string[];
    }
  | { readonly kind: "decline"; readonly reason: string; readonly reasoning: readonly string[] };

export const riskBpsByFailure: Readonly<Record<FailureReason, number>> = {
  LEASE_EXPIRED: 2_500,
  VERDICT_REJECTED: 5_000,
  CHALLENGE_UPHELD: 10_000,
  NO_ELIGIBLE_BIDS: 2_500,
  ATTEMPTS_EXHAUSTED: 2_500,
  DEADLINE_PASSED: 2_500,
};

export const rushBps = 2_500;
const rushWindows = 3;
const wholeBps = 10_000n;

const percent = (bps: number) => `${String(bps / 100)}%`;
const plural = (count: number, noun: string) => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

export function riskLoadingBps(failures: readonly FailureReason[]): number {
  return failures.reduce((total, reason) => total + riskBpsByFailure[reason], 0);
}

function riskLine(market: Market, bps: number): string {
  if (market.failures.length === 0)
    return `epoch ${String(market.epoch)}: no failed attempts yet, no risk loading`;
  const parts = market.failures.map((reason) => `${reason} +${percent(riskBpsByFailure[reason])}`);
  return `epoch ${String(market.epoch)}: ${plural(market.failures.length, "failed attempt")} so far (${parts.join(", ")}), risk loading ${percent(bps)}`;
}

type Line = { readonly agent: FixtureAgent; readonly cost: bigint; readonly price: bigint };

const shareTotal = (shares: readonly PricedShare[]) =>
  sumYocto(shares.map((share) => share.shareYocto));

function fitToBudget(lines: readonly Line[], budget: bigint): PricedShare[] {
  const floor = sumYocto(lines.map((line) => line.cost));
  const markup = sumYocto(lines.map((line) => line.price)) - floor;
  const shares = lines.map((line) => ({
    agent: line.agent,
    shareYocto: line.cost + ((line.price - line.cost) * (budget - floor)) / markup,
  }));
  const remainder = budget - shareTotal(shares);
  return shares.map((share, index) =>
    index === 0 ? { ...share, shareYocto: share.shareYocto + remainder } : share,
  );
}

function decline(reason: string, reasoning: readonly string[]): Quote {
  return { kind: "decline", reason, reasoning: [...reasoning, `declines: ${reason}`] };
}

export function priceRecovery(team: readonly PricedAgent[], market: Market): Quote {
  const amountText = (amount: bigint) => `${formatNear(amount)} ${market.currency ?? "NEAR"}`;
  const units = market.failingCases + 1;
  const risk = riskLoadingBps(market.failures);
  const reasoning = [
    riskLine(market, risk),
    `latest checkpoint fails ${String(market.failingCases)} of ${String(market.publicCases)} public cases: ${plural(units, "unit")} of work (one per failing case, one to re-check the hidden rules)`,
  ];
  if (team.length === 0) return decline("no team to price", reasoning);
  const overloaded = team.find(({ profile }) => units > profile.capacityUnits);
  if (overloaded !== undefined) {
    return decline(
      `${overloaded.agent.agentId} takes at most ${plural(overloaded.profile.capacityUnits, "unit")} and this needs ${String(units)}`,
      reasoning,
    );
  }
  const timid = team.find(({ profile }) => risk > profile.riskAppetiteBps);
  if (timid !== undefined) {
    return decline(
      `${percent(risk)} risk is above ${timid.agent.agentId}'s ${percent(timid.profile.riskAppetiteBps)} appetite`,
      reasoning,
    );
  }
  const durationMs = Math.max(...team.map(({ profile }) => profile.msPerUnit * units));
  if (market.msLeft < durationMs) {
    return decline(
      `needs about ${String(Math.ceil(durationMs / 1_000))} s but ${String(Math.max(0, Math.floor(market.msLeft / 1_000)))} s remain before the deadline`,
      reasoning,
    );
  }
  const rush = market.msLeft < durationMs * rushWindows ? rushBps : 0;
  if (rush > 0) reasoning.push(`the deadline is close: +${percent(rush)} rush premium`);
  const loading = BigInt(risk + rush);
  const lines: Line[] = team.map(({ agent, profile }) => {
    const cost = profile.floorPerUnitYocto * BigInt(units);
    const price = (cost * (wholeBps + loading)) / wholeBps;
    reasoning.push(
      `${agent.agentId} (${agent.role}): floor ${amountText(profile.floorPerUnitYocto)}/unit × ${String(units)} = ${amountText(cost)}, +${percent(risk + rush)} = ${amountText(price)}`,
    );
    return { agent, cost, price };
  });
  const floor = sumYocto(lines.map((line) => line.cost));
  const asked = sumYocto(lines.map((line) => line.price));
  const budget = market.budgetYocto;
  if (floor > budget) {
    return decline(
      `its floor of ${amountText(floor)} is above the ${amountText(budget)} left in escrow plus liability`,
      reasoning,
    );
  }
  const members =
    asked > budget
      ? fitToBudget(lines, budget)
      : lines.map((line) => ({ agent: line.agent, shareYocto: line.price }));
  const amount = shareTotal(members);
  reasoning.push(
    asked > budget
      ? `asks ${amountText(asked)} but ${amountText(budget)} is left: markups scaled down to bid ${amountText(amount)}`
      : `bids ${amountText(amount)} of the ${amountText(budget)} left in escrow plus liability`,
  );
  return {
    kind: "offer",
    amountYocto: amount,
    members,
    estimatedDurationMs: durationMs,
    reasoning,
  };
}
