import { fail, succeed, type SignedBid } from "@backstop/shared";
import { runAuction } from "./auction.js";
import type { Decision, DecisionContext } from "./commands.js";
import type { TaskRecord } from "./record.js";
import { checkSignedBid } from "./signed-bid.js";

export function decideBid(
  record: TaskRecord,
  signed: SignedBid,
  context: DecisionContext,
): Decision {
  const auction = record.auction;
  if (record.state !== "RECOVERY_OPEN" || auction === null) {
    return fail("INVALID_TRANSITION", `No recovery auction is open in ${record.state}`);
  }
  if (context.nowMs > auction.closesAtMs) return fail("BID_WINDOW_CLOSED", "The bid window closed");
  const checked = checkSignedBid(record, signed, context.registry);
  if (!checked.ok) return checked;
  if (checked.value.bid.epoch !== auction.epoch) {
    return fail("STALE_STATE", `The auction is for epoch ${String(auction.epoch)}`);
  }
  if (auction.bids.some((existing) => existing.bidHash === checked.value.bidHash)) {
    return fail("DUPLICATE", "This bid was already submitted");
  }
  return succeed([{ type: "bid_submitted", bid: checked.value }]);
}

export function decideCloseAuction(record: TaskRecord, context: DecisionContext): Decision {
  const auction = record.auction;
  if (record.state !== "RECOVERY_OPEN" || auction === null) {
    return fail("INVALID_TRANSITION", `No recovery auction is open in ${record.state}`);
  }
  if (context.nowMs <= auction.closesAtMs)
    return fail("POLICY_VIOLATION", "The bid window is open");
  const result = runAuction(auction.bids, record.ledger, context.nowMs, record.excludedAgents);
  if (result.winner === null) {
    return succeed([{ type: "terminal_failure", reason: "NO_ELIGIBLE_BIDS" }]);
  }
  return succeed([
    {
      type: "recovery_awarded",
      epoch: auction.epoch,
      winner: result.winner.bidHash,
      rejected: result.rejected,
    },
    {
      type: "attempt_assigned",
      attempt: record.attempt + 1,
      epoch: auction.epoch,
      bid: result.winner,
      claimByMs: context.nowMs + record.manifest.policy.leaseMs,
    },
  ]);
}
