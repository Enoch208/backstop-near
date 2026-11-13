import type { Command } from "./commands.js";
import { preAcceptanceStates } from "./transitions.js";
import type { TaskRecord } from "./record.js";

export function dueCommands(record: TaskRecord, nowMs: number): Command[] {
  if (preAcceptanceStates.includes(record.state) && nowMs > record.manifest.deadlineMs) {
    return [{ kind: "expireDeadline" }];
  }
  const grace = record.manifest.policy.heartbeatGraceMs;
  const leaseLapsed = record.lease !== null && nowMs > record.lease.expiresAtMs + grace;
  const claimLapsed =
    (record.state === "ASSIGNED" || record.state === "RECOVERY_ASSIGNED") &&
    record.assignment !== null &&
    nowMs > record.assignment.claimByMs;
  if ((record.state === "EXECUTING" && leaseLapsed) || claimLapsed)
    return [{ kind: "expireLease" }];
  if (
    record.state === "RECOVERY_OPEN" &&
    record.auction !== null &&
    nowMs > record.auction.closesAtMs
  ) {
    return [{ kind: "closeAuction" }];
  }
  const deadline = record.candidate?.challengeDeadlineMs ?? null;
  if (record.state === "VERIFYING" && deadline !== null && nowMs > deadline) {
    return [{ kind: "closeChallengeWindow" }];
  }
  if (record.state === "ACCEPTED") return [{ kind: "settle" }];
  if (record.state === "TERMINAL_FAILURE") return [{ kind: "settleFailure" }];
  return [];
}
