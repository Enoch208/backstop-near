import {
  decideToJoin,
  endorseBid,
  priceRecovery,
  pricedBid,
  recoveryTeam,
  roster,
  type RosterName,
} from "@backstop/agents";
import {
  depositEscrow,
  depositPremium,
  failureLegs,
  openLedger,
  postGuarantee,
  recoveryCapacity,
  successLegs,
  type Ledger,
  type Payee,
} from "@backstop/ledger";
import { runAuction } from "@backstop/orchestrator";
import {
  formatNear,
  fromYocto,
  leadAgent,
  near,
  signingKeyFromSeed,
  sumYocto,
  type FailureReason,
  type Outcome,
  type SignedBid,
} from "@backstop/shared";

export const modes = ["single", "fixed", "market"] as const;
export type Mode = (typeof modes)[number];

const economics = {
  escrow: "0.40",
  premium: "0.04",
  bond: "0.25",
  compensationCap: "0.15",
  fixedPayment: "0.40",
};

function requireOutcome<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`Unexpected benchmark ledger error ${outcome.failure.code}`);
  return outcome.value;
}

export function fundedLedger(): Ledger {
  const ledger = openLedger("benchmark-customer.testnet");
  const funded = requireOutcome(depositEscrow(ledger, near(economics.escrow)));
  const premium = requireOutcome(depositPremium(funded, near(economics.premium)));
  return requireOutcome(
    postGuarantee(
      premium,
      "benchmark-guarantor.testnet",
      near(economics.bond),
      near(economics.bond),
    ),
  );
}

export type Assignment = {
  readonly lead: string;
  readonly payees: Payee[];
  readonly bids: ReadonlyArray<{
    readonly lead: string;
    readonly quote: string;
    readonly reason: string;
    readonly signedBidHash?: string;
  }>;
};

const standbyIds = ["standby-a", "standby-b"] as const;

export function standbyBids(taskId: string, ledger: Ledger, maxRecoveryAttempts: number) {
  const standbyWorkers = standbyIds.map((agentId) => ({
    ...roster.epsilon,
    agentId,
    account: `${agentId}.fixture.testnet`,
    key: signingKeyFromSeed(`benchmark-reservation:${agentId}`),
  }));
  const capacity = recoveryCapacity(ledger);
  return Array.from({ length: maxRecoveryAttempts }, (_, index) =>
    standbyWorkers.map((agent, order) => {
      const quote = (capacity * BigInt(80 + 10 * order)) / 100n;
      return pricedBid(
        { taskId, epoch: index + 1, nowMs: 1_000, bidWindowMs: 100 },
        "Prepriced backup slot for a full repair on the second inference provider",
        {
          kind: "offer",
          amountYocto: quote,
          members: [{ agent, shareYocto: quote }],
          estimatedDurationMs: 45_000,
          reasoning: [],
        },
      );
    }),
  );
}

export function choose(
  mode: Mode,
  ledger: Ledger,
  context: {
    taskId: string;
    attempt: number;
    failures: readonly FailureReason[];
    excluded: readonly string[];
    unavailable: readonly string[];
    costBps: Readonly<Record<string, number>>;
    failingCases: number;
    publicCases: number;
    msLeft: number;
    standby?: readonly SignedBid[];
  },
): Assignment {
  const {
    taskId,
    attempt,
    excluded,
    unavailable,
    costBps,
    failures,
    failingCases,
    publicCases,
    msLeft,
    standby,
  } = context;
  const available = (agent: string) => !unavailable.includes(agent);
  const noAssignment = { lead: "", payees: [], bids: [] };
  if (mode === "single" || attempt === 1) {
    if (!available("alpha")) return noAssignment;
    return {
      lead: "alpha",
      payees: [{ account: roster.alpha.account, amount: near(economics.fixedPayment) }],
      bids: [],
    };
  }
  const leads = ["beta", "gamma", "epsilon"] as const satisfies readonly RosterName[];
  const trace: Assignment["bids"][number][] = [];
  const bids = leads.flatMap((lead) => {
    const team = recoveryTeam(lead);
    if (team === null) throw new Error(`No roster pricing for ${lead}`);
    if (
      team.team.some(({ agent }) => !available(agent.agentId) || excluded.includes(agent.agentId))
    ) {
      trace.push({ lead, quote: "", reason: "unavailable-or-excluded" });
      return [];
    }
    const priced = team.team.map(({ agent, profile }) => ({
      agent,
      profile: {
        ...profile,
        floorPerUnitYocto:
          (profile.floorPerUnitYocto * BigInt(costBps[agent.agentId] ?? 10_000)) / 10_000n,
      },
    }));
    const quote = priceRecovery(priced, {
      budgetYocto: recoveryCapacity(ledger),
      epoch: attempt - 1,
      failures,
      failingCases,
      publicCases,
      msLeft,
    });
    if (quote.kind === "decline") {
      trace.push({ lead, quote: "", reason: quote.reason });
      return [];
    }
    const bid = pricedBid(
      { taskId, epoch: attempt - 1, nowMs: 1000, bidWindowMs: 100 },
      team.plan,
      quote,
    );
    const join = lead === "gamma" ? decideToJoin(roster.delta, bid, excluded) : null;
    if (join?.join === false) {
      trace.push({
        lead,
        quote: formatNear(quote.amountYocto),
        reason: join.reason,
        signedBidHash: bid.bidHash,
      });
      return [];
    }
    trace.push({
      lead,
      quote: formatNear(quote.amountYocto),
      reason: "submitted",
      signedBidHash: bid.bidHash,
    });
    return [join?.join === true ? endorseBid(bid, roster.delta) : bid];
  });
  const availableStandby = (standby ?? []).filter(
    ({ bid }) =>
      bid.estimatedDurationMs <= msLeft &&
      bid.members.every(({ agentId }) => available(agentId) && !excluded.includes(agentId)),
  );
  const offers = bids.length > 0 ? bids : availableStandby;
  if (bids.length === 0) {
    trace.push(
      ...availableStandby.map(({ bid, bidHash }) => ({
        lead: leadAgent(bid),
        quote: formatNear(fromYocto(bid.amountYocto)),
        reason: "standby",
        signedBidHash: bidHash,
      })),
    );
  }
  if (mode === "fixed") {
    const next = offers[0];
    if (next === undefined) return noAssignment;
    return {
      lead: leadAgent(next.bid),
      payees: next.bid.members.map((member) => ({
        account: member.account,
        amount: fromYocto(member.shareYocto),
      })),
      bids: [],
    };
  }
  const { winner, rejected } = runAuction(offers, ledger, 1100, excluded);
  const records = trace.map((bid) => ({
    ...bid,
    reason: rejected.find((entry) => entry.bidHash === bid.signedBidHash)?.reason ?? bid.reason,
  }));
  return {
    lead: winner === null ? "" : leadAgent(winner.bid),
    payees:
      winner?.bid.members.map((member) => ({
        account: member.account,
        amount: fromYocto(member.shareYocto),
      })) ?? [],
    bids: records,
  };
}

export function accounting(
  ledger: Ledger,
  assignment: Assignment | null,
  primarySucceeded: boolean,
) {
  const legs =
    assignment === null
      ? failureLegs(ledger, near(economics.compensationCap))
      : requireOutcome(successLegs(ledger, { payees: assignment.payees, primarySucceeded }));
  const transferredToCustomer = sumYocto(
    legs.filter((leg) => leg.recipient === ledger.customer).map((leg) => leg.amount),
  );
  return {
    customerNetNear: signedNear(
      ledger.inflow.escrow + ledger.inflow.premium - transferredToCustomer,
    ),
    compensationNear: formatNear(
      sumYocto(legs.filter((leg) => leg.purpose === "compensation").map((leg) => leg.amount)),
    ),
    bondConsumedNear: formatNear(
      sumYocto(
        legs
          .filter((leg) => leg.pool === "bond" && leg.purpose !== "bond_release")
          .map((leg) => leg.amount),
      ),
    ),
    operatorPayoutNear: formatNear(
      sumYocto(legs.filter((leg) => leg.purpose === "payout").map((leg) => leg.amount)),
    ),
  };
}

function signedNear(amount: bigint): string {
  return amount < 0n ? `-${formatNear(-amount)}` : formatNear(amount);
}
