import type { FailureReason } from "@backstop/shared";
import type { TaskEventBody } from "./events.js";
import type { TaskRecord } from "./record.js";

export function afterFailure(record: TaskRecord, nowMs: number): TaskEventBody {
  if (nowMs > record.manifest.deadlineMs)
    return { type: "terminal_failure", reason: "DEADLINE_PASSED" };
  if (record.attempt >= record.manifest.policy.maxAttempts) {
    return { type: "terminal_failure", reason: "ATTEMPTS_EXHAUSTED" };
  }
  const reason: FailureReason = record.failures.at(-1)?.reason ?? "LEASE_EXPIRED";
  return {
    type: "recovery_opened",
    epoch: record.epoch + 1,
    reason,
    closesAtMs: nowMs + record.manifest.policy.bidWindowMs,
  };
}

export function assignedAgents(record: TaskRecord): string[] {
  return record.assignment?.bid.bid.members.map((member) => member.agentId) ?? [];
}

export function failAttempt(
  record: TaskRecord,
  nowMs: number,
  reason: FailureReason,
): TaskEventBody[] {
  const failed: TaskEventBody = {
    type: "attempt_failed",
    attempt: record.attempt,
    reason,
    agents: assignedAgents(record),
  };
  const withFailure = {
    ...record,
    failures: [...record.failures, { attempt: record.attempt, reason }],
  };
  return [failed, afterFailure(withFailure, nowMs)];
}
