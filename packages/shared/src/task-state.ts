export const taskStates = [
  "DRAFT",
  "FUNDED",
  "BONDED",
  "ASSIGNED",
  "EXECUTING",
  "FAILED_ATTEMPT",
  "RECOVERY_OPEN",
  "RECOVERY_ASSIGNED",
  "VERIFYING",
  "REJECTED",
  "ACCEPTED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "TERMINAL_FAILURE",
  "FAILURE_SETTLEMENT_PENDING",
  "FAILURE_SETTLED",
] as const;
export type TaskState = (typeof taskStates)[number];

export const terminalStates = [
  "SETTLED",
  "FAILURE_SETTLED",
] as const satisfies readonly TaskState[];

export const agentRoles = [
  "executor",
  "diagnostician",
  "repairer",
  "verifier",
  "challenger",
  "guarantor",
] as const;
export type AgentRole = (typeof agentRoles)[number];

export const failureReasons = [
  "LEASE_EXPIRED",
  "PROVIDER_TIMEOUT",
  "PROMPT_LIMIT",
  "INVALID_OUTPUT",
  "VERDICT_REJECTED",
  "CHALLENGE_UPHELD",
  "NO_ELIGIBLE_BIDS",
  "ATTEMPTS_EXHAUSTED",
  "DEADLINE_PASSED",
] as const;
export type FailureReason = (typeof failureReasons)[number];

export const workerFailureReasons = ["PROVIDER_TIMEOUT", "PROMPT_LIMIT", "INVALID_OUTPUT"] as const;
export type WorkerFailureReason = (typeof workerFailureReasons)[number];
