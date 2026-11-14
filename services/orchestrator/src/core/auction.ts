import { recoveryCapacity, type Ledger } from "@backstop/ledger";
import { fromYocto, leadAgent, type RecoveryStrategy, type SignedBid } from "@backstop/shared";
import type { RejectedBid } from "./events.js";

export type AuctionResult = {
  readonly winner: SignedBid | null;
  readonly rejected: readonly RejectedBid[];
};

function ineligibility(
  signed: SignedBid,
  capacity: bigint,
  nowMs: number,
  excluded: readonly string[],
): string | null {
  if (signed.bid.expiresAtMs < nowMs) return "expired before the award";
  if (fromYocto(signed.bid.amountYocto) > capacity) return "over the remaining recovery budget";
  if (signed.bid.members.some((member) => excluded.includes(member.agentId))) {
    return "includes an agent that already failed this task";
  }
  return null;
}

function priceDifference(a: SignedBid, b: SignedBid): number {
  const byAmount = fromYocto(a.bid.amountYocto) - fromYocto(b.bid.amountYocto);
  return byAmount < 0n ? -1 : byAmount > 0n ? 1 : 0;
}

function earlierFirst(a: SignedBid, b: SignedBid): number {
  if (a.bid.committedAtMs !== b.bid.committedAtMs) return a.bid.committedAtMs - b.bid.committedAtMs;
  return a.bidHash < b.bidHash ? -1 : a.bidHash > b.bidHash ? 1 : 0;
}

export function runAuction(
  bids: readonly SignedBid[],
  ledger: Ledger,
  nowMs: number,
  excluded: readonly string[],
  fixedOrder?: readonly string[],
  preferredStrategy?: RecoveryStrategy,
): AuctionResult {
  const capacity = recoveryCapacity(ledger);
  const verdicts = bids.map((signed) => ({
    signed,
    reason:
      fixedOrder !== undefined && !fixedOrder.includes(leadAgent(signed.bid))
        ? "outside the fixed specialist roster"
        : ineligibility(signed, capacity, nowMs, excluded),
  }));
  const eligible = verdicts.filter((entry) => entry.reason === null).map((entry) => entry.signed);
  const strategyRank = (bid: SignedBid) =>
    Number(preferredStrategy !== undefined && bid.bid.strategy !== preferredStrategy);
  const [winner = null, ...outbid] = [...eligible].sort(
    (a, b) =>
      (fixedOrder === undefined
        ? priceDifference(a, b) || strategyRank(a) - strategyRank(b)
        : fixedOrder.indexOf(leadAgent(a.bid)) - fixedOrder.indexOf(leadAgent(b.bid)) ||
          priceDifference(a, b)) || earlierFirst(a, b),
  );
  return {
    winner,
    rejected: [
      ...verdicts.flatMap((entry) =>
        entry.reason === null ? [] : [{ bidHash: entry.signed.bidHash, reason: entry.reason }],
      ),
      ...outbid.map((signed) => ({
        bidHash: signed.bidHash,
        reason:
          fixedOrder !== undefined
            ? "later in fixed specialist order"
            : winner !== null &&
                priceDifference(signed, winner) === 0 &&
                strategyRank(signed) > strategyRank(winner)
              ? "less suitable recovery strategy"
              : "outbid",
      })),
    ],
  };
}
