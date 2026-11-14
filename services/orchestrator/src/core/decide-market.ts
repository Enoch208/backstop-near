import {
  fail,
  fromYocto,
  leadAgent,
  pendingEndorsers,
  succeed,
  type Digest,
  type Endorsement,
  type SignedBid,
} from "@backstop/shared";
import { recoveryCapacity } from "@backstop/ledger";
import { runAuction } from "./auction.js";
import type { Decision, DecisionContext } from "./commands.js";
import type { TaskRecord } from "./record.js";
import { checkEndorsement, checkSignedBid } from "./signed-bid.js";

export function decideReserveStandby(
  record: TaskRecord,
  signed: SignedBid,
  context: DecisionContext,
): Decision {
  const open = record.state === "RECOVERY_OPEN";
  if (
    ![
      "BONDED",
      "ASSIGNED",
      "EXECUTING",
      "VERIFYING",
      "RECOVERY_OPEN",
      "RECOVERY_ASSIGNED",
    ].includes(record.state)
  )
    return fail("INVALID_TRANSITION", `Standby capacity cannot be reserved in ${record.state}`);
  const checked = checkSignedBid(record, signed, context.registry);
  if (!checked.ok) return checked;
  const { bid, bidHash } = checked.value;
  const [member] = bid.members;
  if (
    bid.purpose !== "standby" ||
    bid.members.length !== 1 ||
    member?.role !== "repairer" ||
    bid.epoch <= (open ? record.epoch - 1 : record.epoch) ||
    bid.epoch >= record.manifest.policy.maxAttempts ||
    bid.committedAtMs > context.nowMs + 30_000 ||
    bid.expiresAtMs <= context.nowMs ||
    bid.expiresAtMs > record.manifest.deadlineMs ||
    bid.committedAtMs >= bid.expiresAtMs ||
    bid.estimatedDurationMs > record.manifest.deadlineMs - context.nowMs
  )
    return fail("POLICY_VIOLATION", "Standby must name one repairer and a live recovery epoch");
  if (open && bid.epoch === record.epoch && context.nowMs > (record.auction?.closesAtMs ?? 0))
    return fail("BID_WINDOW_CLOSED", "The bid window closed");
  if (record.assignment?.bid.bid.members.some(({ agentId }) => agentId === member.agentId))
    return fail("POLICY_VIOLATION", "The active assignment cannot reserve standby capacity");
  if (context.busyAgents?.has(member.agentId))
    return fail("POLICY_VIOLATION", "The worker already has a commitment to another task");
  const amount = fromYocto(bid.amountYocto);
  if (amount <= 0n || amount > recoveryCapacity(record.ledger))
    return fail("BUDGET_EXCEEDED", "The standby price must be positive and fit funded recovery");
  const existing = record.standby.find(
    (entry) =>
      entry.bid.epoch === bid.epoch &&
      leadAgent(entry.bid) === member.agentId &&
      entry.bid.expiresAtMs >= context.nowMs,
  );
  if (existing !== undefined)
    return existing.bidHash === bidHash
      ? succeed([])
      : fail("DUPLICATE", "A live reservation already exists for that worker and epoch");
  return succeed([{ type: "standby_reserved", bid: checked.value }]);
}

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
  if (checked.value.bid.purpose === "standby")
    return fail("POLICY_VIOLATION", "A standby bid must reserve capacity");
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

export function decideConfirmStandby(
  record: TaskRecord,
  agentId: string,
  epoch: number,
  context: DecisionContext,
): Decision {
  if (record.state !== "RECOVERY_OPEN" || record.auction?.epoch !== epoch)
    return fail("STALE_STATE", "There is no recovery window for that epoch");
  if (context.nowMs > record.auction.closesAtMs)
    return fail("BID_WINDOW_CLOSED", "The bid window closed");
  const reservation = record.standby.find(
    ({ bid }) =>
      bid.epoch === epoch && leadAgent(bid) === agentId && bid.expiresAtMs >= context.nowMs,
  );
  if (reservation === undefined || record.excludedAgents.includes(agentId))
    return fail("NOT_FOUND", "There is no live standby reservation for this worker and epoch");
  if (record.standbyAvailability[reservation.bidHash] === epoch) return succeed([]);
  return succeed([{ type: "standby_ready", bidHash: reservation.bidHash, epoch }]);
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
  const excluded = [...record.excludedAgents, ...(context.busyAgents ?? [])];
  const fixedOrder = record.manifest.policy.recoveryOrder;
  const ordinary = runAuction(auction.bids, record.ledger, context.nowMs, excluded, fixedOrder);
  const standby =
    ordinary.winner === null
      ? runAuction(
          record.standby.filter(
            ({ bid, bidHash }) =>
              bid.epoch === auction.epoch &&
              record.standbyAvailability[bidHash] === auction.epoch &&
              bid.estimatedDurationMs <= record.manifest.deadlineMs - context.nowMs,
          ),
          record.ledger,
          context.nowMs,
          excluded,
          fixedOrder,
        )
      : null;
  const winner = ordinary.winner ?? standby?.winner ?? null;
  if (winner === null) {
    return succeed([{ type: "terminal_failure", reason: "NO_ELIGIBLE_BIDS" }]);
  }
  return succeed([
    ...(standby === null
      ? []
      : [{ type: "standby_activated" as const, bidHash: winner.bidHash, epoch: auction.epoch }]),
    {
      type: "recovery_awarded",
      epoch: auction.epoch,
      winner: winner.bidHash,
      rejected: [...ordinary.rejected, ...(standby?.rejected ?? [])],
    },
    {
      type: "attempt_assigned",
      attempt: record.attempt + 1,
      epoch: auction.epoch,
      bid: winner,
      claimByMs: context.nowMs + record.manifest.policy.leaseMs,
    },
  ]);
}
