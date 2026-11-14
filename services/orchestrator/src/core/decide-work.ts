import {
  checkpointHash,
  fail,
  leadAgent,
  succeed,
  type Checkpoint,
  type Digest,
  type WorkerFailureReason,
} from "@backstop/shared";
import type { Decision, DecisionContext } from "./commands.js";
import { lastCheckpointHash, type TaskRecord } from "./record.js";
import { failAttempt } from "./recovery.js";

function activeLease(record: TaskRecord, agentId: string, fencingToken: number, nowMs: number) {
  const lease = record.lease;
  if (record.state !== "EXECUTING" || lease === null) {
    return fail("STALE_LEASE", "Attempt is no longer active");
  }
  if (lease.agentId !== agentId || lease.fencingToken !== fencingToken) {
    return fail("STALE_LEASE", `Fencing token ${String(fencingToken)} is not the active lease`);
  }
  if (nowMs > lease.expiresAtMs + record.manifest.policy.heartbeatGraceMs) {
    return fail("STALE_LEASE", "The lease has expired");
  }
  return succeed(lease);
}

export function decideReportFailure(
  record: TaskRecord,
  agentId: string,
  fencingToken: number,
  reason: WorkerFailureReason,
  context: DecisionContext,
): Decision {
  const lease = activeLease(record, agentId, fencingToken, context.nowMs);
  if (!lease.ok) return lease;
  return succeed(
    failAttempt(record, context.nowMs, reason).map((event) =>
      event.type === "attempt_failed" ? { ...event, reportedBy: agentId, fencingToken } : event,
    ),
  );
}

export function decideClaim(
  record: TaskRecord,
  agentId: string,
  context: DecisionContext,
): Decision {
  if (record.state === "EXECUTING") return fail("LEASE_HELD", "Another worker holds the lease");
  if (record.state !== "ASSIGNED" && record.state !== "RECOVERY_ASSIGNED") {
    return fail("INVALID_TRANSITION", `Nothing to claim in ${record.state}`);
  }
  const assignment = record.assignment;
  if (assignment === null || leadAgent(assignment.bid.bid) !== agentId) {
    return fail("UNAUTHORIZED", `${agentId} is not assigned to attempt ${String(record.attempt)}`);
  }
  if (context.nowMs > assignment.claimByMs) return fail("STALE_LEASE", "The claim window closed");
  return succeed([
    {
      type: "lease_granted",
      lease: {
        taskId: record.taskId,
        attempt: record.attempt,
        epoch: record.epoch,
        agentId,
        fencingToken: record.fencingToken + 1,
        grantedAtMs: context.nowMs,
        expiresAtMs: context.nowMs + record.manifest.policy.leaseMs,
      },
    },
  ]);
}

export function decideHeartbeat(
  record: TaskRecord,
  agentId: string,
  fencingToken: number,
  context: DecisionContext,
): Decision {
  const lease = activeLease(record, agentId, fencingToken, context.nowMs);
  if (!lease.ok) return lease;
  return succeed([
    {
      type: "heartbeat_recorded",
      fencingToken,
      expiresAtMs: context.nowMs + record.manifest.policy.leaseMs,
    },
  ]);
}

export function decideCheckpoint(
  record: TaskRecord,
  agentId: string,
  fencingToken: number,
  checkpoint: Checkpoint,
  context: DecisionContext,
): Decision {
  const lease = activeLease(record, agentId, fencingToken, context.nowMs);
  if (!lease.ok) return lease;
  if (checkpoint.taskId !== record.taskId || checkpoint.attempt !== record.attempt) {
    return fail("POLICY_VIOLATION", "The checkpoint belongs to another attempt");
  }
  if (checkpoint.parentCheckpointHash !== lastCheckpointHash(record)) {
    return fail("STALE_STATE", "The checkpoint does not extend the latest checkpoint");
  }
  return succeed([
    { type: "checkpoint_recorded", checkpoint, checkpointHash: checkpointHash(checkpoint) },
  ]);
}

export function decideSubmit(
  record: TaskRecord,
  agentId: string,
  fencingToken: number,
  artifactHash: Digest,
  checkpoint: Digest | null,
  context: DecisionContext,
): Decision {
  const lease = activeLease(record, agentId, fencingToken, context.nowMs);
  if (!lease.ok) return lease;
  if (checkpoint !== null && !record.checkpoints.some((entry) => entry.hash === checkpoint)) {
    return fail("NOT_FOUND", "The submission names an unknown checkpoint");
  }
  return succeed([
    {
      type: "artifact_submitted",
      attempt: record.attempt,
      fencingToken,
      agentId,
      artifactHash,
      checkpointHash: checkpoint,
    },
  ]);
}

export function decideExpireLease(record: TaskRecord, context: DecisionContext): Decision {
  const grace = record.manifest.policy.heartbeatGraceMs;
  if (record.state === "EXECUTING" && record.lease !== null) {
    if (context.nowMs <= record.lease.expiresAtMs + grace) {
      return fail("POLICY_VIOLATION", "The lease is still live");
    }
    return succeed([
      { type: "lease_expired", attempt: record.attempt, fencingToken: record.lease.fencingToken },
      ...failAttempt(record, context.nowMs, "LEASE_EXPIRED"),
    ]);
  }
  const unclaimed = record.state === "ASSIGNED" || record.state === "RECOVERY_ASSIGNED";
  if (unclaimed && record.assignment !== null && context.nowMs > record.assignment.claimByMs) {
    return succeed([
      { type: "lease_expired", attempt: record.attempt, fencingToken: null },
      ...failAttempt(record, context.nowMs, "LEASE_EXPIRED"),
    ]);
  }
  return fail("POLICY_VIOLATION", `No expired lease in ${record.state}`);
}
