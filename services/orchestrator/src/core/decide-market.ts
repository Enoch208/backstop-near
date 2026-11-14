import {
  fail,
  pendingEndorsers,
  succeed,
  type Digest,
  type Endorsement,
  type SignedBid,
} from "@backstop/shared";
import { runAuction } from "./auction.js";
import type { Decision, DecisionContext } from "./commands.js";
import type { TaskRecord } from "./record.js";
import { checkEndorsement, checkSignedBid } from "./signed-bid.js";

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
  const known = [...auction.bids, ...auction.proposals];
  if (known.some((existing) => existing.bidHash === checked.value.bidHash)) {
    return fail("DUPLICATE", "This bid was already submitted");
  }
  if (pendingEndorsers(checked.value).length > 0) {
    return succeed([{ type: "coalition_proposed", bid: checked.value }]);
  }
  return succeed([{ type: "bid_submitted", bid: checked.value }]);
}

export function decideEndorse(
  record: TaskRecord,
  bidHash: Digest,
  endorsement: Endorsement,
  context: DecisionContext,
): Decision {
  const auction = record.auction;
  if (record.state !== "RECOVERY_OPEN" || auction === null) {
    return fail("INVALID_TRANSITION", `No recovery auction is open in ${record.state}`);
  }
  if (context.nowMs > auction.closesAtMs) return fail("BID_WINDOW_CLOSED", "The bid window closed");
  const proposal = auction.proposals.find((candidate) => candidate.bidHash === bidHash);
  if (proposal === undefined) return fail("NOT_FOUND", "No open coalition proposal has that hash");
  if (!pendingEndorsers(proposal).includes(endorsement.agentId)) {
    return fail("DUPLICATE", `${endorsement.agentId} has nothing left to endorse on this proposal`);
  }
  const problem = checkEndorsement(proposal, endorsement, context.registry);
  if (problem !== null) return fail("BAD_SIGNATURE", problem);
  const endorsed = { ...proposal, endorsements: [...proposal.endorsements, endorsement] };
  return succeed([
    { type: "coalition_endorsed", bidHash, endorsement },
    ...(pendingEndorsers(endorsed).length === 0
      ? [{ type: "bid_submitted" as const, bid: endorsed }]
      : []),
  ]);
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
