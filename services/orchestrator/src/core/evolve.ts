import {
  beginSettlement,
  depositEscrow,
  depositPremium,
  postGuarantee,
  resolveTransfer,
  retryTransfer,
  type Ledger,
} from "@backstop/ledger";
import { fromYocto, type Outcome, type TaskState } from "@backstop/shared";
import type { TaskEvent, TaskEventBody } from "./events.js";
import { newRecord, type TaskRecord } from "./record.js";
import { canTransition } from "./transitions.js";

function settled(outcome: Outcome<Ledger>): Ledger {
  if (!outcome.ok) throw new Error(`Corrupt event log: ${outcome.failure.message}`);
  return outcome.value;
}

function fundedState(record: TaskRecord, ledger: Ledger): TaskState {
  const budget = record.manifest.budget;
  const funded =
    ledger.inflow.escrow >= fromYocto(budget.escrowYocto) &&
    ledger.inflow.premium >= fromYocto(budget.premiumYocto);
  return record.state === "DRAFT" && funded ? "FUNDED" : record.state;
}

function exclude(record: TaskRecord, agents: readonly string[]): readonly string[] {
  return [...new Set([...record.excludedAgents, ...agents])];
}

function apply(record: TaskRecord, body: TaskEventBody): TaskRecord {
  switch (body.type) {
    case "task_created":
      return record;
    case "funds_deposited": {
      const amount = fromYocto(body.amountYocto);
      const ledger = settled(
        body.pool === "escrow"
          ? depositEscrow(record.ledger, amount)
          : depositPremium(record.ledger, amount),
      );
      return { ...record, ledger, state: fundedState(record, ledger) };
    }
    case "guarantee_posted": {
      const ledger = settled(
        postGuarantee(
          record.ledger,
          body.guarantor,
          fromYocto(body.bondYocto),
          fromYocto(body.liabilityYocto),
        ),
      );
      return { ...record, ledger, state: "BONDED" };
    }
    case "attempt_assigned":
      return {
        ...record,
        state: body.epoch === 0 ? "ASSIGNED" : "RECOVERY_ASSIGNED",
        attempt: body.attempt,
        assignment: {
          attempt: body.attempt,
          epoch: body.epoch,
          bid: body.bid,
          claimByMs: body.claimByMs,
        },
        lease: null,
        candidate: null,
      };
    case "lease_granted":
      return {
        ...record,
        state: "EXECUTING",
        lease: body.lease,
        fencingToken: body.lease.fencingToken,
      };
    case "heartbeat_recorded":
      return record.lease === null
        ? record
        : { ...record, lease: { ...record.lease, expiresAtMs: body.expiresAtMs } };
    case "checkpoint_recorded":
      return {
        ...record,
        checkpoints: [
          ...record.checkpoints,
          { checkpoint: body.checkpoint, hash: body.checkpointHash },
        ],
      };
    case "artifact_submitted":
      return {
        ...record,
        state: "VERIFYING",
        lease: null,
        candidate: {
          attempt: body.attempt,
          fencingToken: body.fencingToken,
          agentId: body.agentId,
          artifactHash: body.artifactHash,
          checkpointHash: body.checkpointHash,
          evidence: null,
          challengeDeadlineMs: null,
        },
      };
    case "lease_expired":
      return { ...record, lease: null };
    case "attempt_failed":
      return {
        ...record,
        state: "FAILED_ATTEMPT",
        failures: [...record.failures, { attempt: body.attempt, reason: body.reason }],
        excludedAgents: exclude(record, body.agents),
      };
    case "recovery_opened":
      return {
        ...record,
        state: "RECOVERY_OPEN",
        epoch: body.epoch,
        auction: { epoch: body.epoch, closesAtMs: body.closesAtMs, bids: [], proposals: [] },
        assignment: null,
        candidate: null,
      };
    case "coalition_proposed":
      return record.auction === null
        ? record
        : {
            ...record,
            auction: { ...record.auction, proposals: [...record.auction.proposals, body.bid] },
          };
    case "coalition_endorsed":
      return record.auction === null
        ? record
        : {
            ...record,
            auction: {
              ...record.auction,
              proposals: record.auction.proposals.map((proposal) =>
                proposal.bidHash === body.bidHash
                  ? { ...proposal, endorsements: [...proposal.endorsements, body.endorsement] }
                  : proposal,
              ),
            },
          };
    case "bid_submitted":
      return record.auction === null
        ? record
        : {
            ...record,
            auction: {
              ...record.auction,
              bids: [...record.auction.bids, body.bid],
              proposals: record.auction.proposals.filter(
                (proposal) => proposal.bidHash !== body.bid.bidHash,
              ),
            },
          };
    case "recovery_awarded":
      return record;
    case "verification_recorded":
      return record.candidate === null
        ? record
        : {
            ...record,
            candidate: {
              ...record.candidate,
              evidence: body.evidence,
              challengeDeadlineMs: body.challengeDeadlineMs,
            },
          };
    case "challenge_dismissed":
      return record;
    case "attempt_rejected":
      return {
        ...record,
        state: "REJECTED",
        failures: [...record.failures, { attempt: body.attempt, reason: body.reason }],
        excludedAgents: exclude(record, body.agents),
      };
    case "task_accepted":
      return { ...record, state: "ACCEPTED" };
    case "terminal_failure":
      return { ...record, state: "TERMINAL_FAILURE", lease: null, auction: null };
    case "settlement_started": {
      const legs = body.legs.map((leg) => ({ ...leg, amount: fromYocto(leg.amountYocto) }));
      const ledger = settled(
        beginSettlement(
          record.ledger,
          { taskId: record.taskId, kind: body.kind, attempt: body.attempt },
          legs,
        ),
      );
      const state = body.kind === "success" ? "SETTLEMENT_PENDING" : "FAILURE_SETTLEMENT_PENDING";
      return { ...record, ledger, state };
    }
    case "transfer_resolved":
      return {
        ...record,
        ledger: settled(resolveTransfer(record.ledger, body.transferId, body.succeeded)),
      };
    case "transfer_retried":
      return { ...record, ledger: settled(retryTransfer(record.ledger, body.transferId)) };
    case "task_settled":
      return { ...record, state: body.kind === "success" ? "SETTLED" : "FAILURE_SETTLED" };
  }
}

export function evolve(record: TaskRecord | null, event: TaskEvent): TaskRecord {
  const base =
    record ??
    (event.body.type === "task_created"
      ? newRecord(event.body.manifest, event.body.manifestHash)
      : null);
  if (base === null) throw new Error(`Corrupt event log: ${event.eventId} precedes task_created`);
  if (event.version !== base.version + 1 && record !== null) {
    throw new Error(
      `Corrupt event log: ${event.eventId} skips from version ${String(base.version)}`,
    );
  }
  const next = apply(base, event.body);
  if (!canTransition(base.state, next.state)) {
    throw new Error(`Corrupt event log: ${base.state} cannot become ${next.state}`);
  }
  return { ...next, version: event.version };
}
