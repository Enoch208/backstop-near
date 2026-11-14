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
  sumYocto,
  type FailureReason,
  type Outcome,
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
  if (mode === "fixed") {
    const next = bids[0];
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
  const { winner, rejected } = runAuction(bids, ledger, 1100, excluded);
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
