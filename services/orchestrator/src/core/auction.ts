import { recoveryCapacity, type Ledger } from "@backstop/ledger";
import { fromYocto, type SignedBid } from "@backstop/shared";
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

function cheaperFirst(a: SignedBid, b: SignedBid): number {
  const byAmount = fromYocto(a.bid.amountYocto) - fromYocto(b.bid.amountYocto);
  if (byAmount !== 0n) return byAmount < 0n ? -1 : 1;
  if (a.bid.committedAtMs !== b.bid.committedAtMs) return a.bid.committedAtMs - b.bid.committedAtMs;
  return a.bidHash < b.bidHash ? -1 : a.bidHash > b.bidHash ? 1 : 0;
}

export function runAuction(
  bids: readonly SignedBid[],
  ledger: Ledger,
  nowMs: number,
  excluded: readonly string[],
): AuctionResult {
  const capacity = recoveryCapacity(ledger);
  const verdicts = bids.map((signed) => ({
    signed,
    reason: ineligibility(signed, capacity, nowMs, excluded),
  }));
  const eligible = verdicts.filter((entry) => entry.reason === null).map((entry) => entry.signed);
  const [winner = null, ...outbid] = [...eligible].sort(cheaperFirst);
  return {
    winner,
    rejected: [
      ...verdicts.flatMap((entry) =>
        entry.reason === null ? [] : [{ bidHash: entry.signed.bidHash, reason: entry.reason }],
      ),
      ...outbid.map((signed) => ({ bidHash: signed.bidHash, reason: "outbid" })),
    ],
  };
}
