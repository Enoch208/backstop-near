import type { RecoveryStrategy } from "@backstop/shared";
import type { TaskRecord } from "./record.js";
import type { Registry } from "./commands.js";

export function exhaustedFailureDomain(record: TaskRecord, registry: Registry): string | undefined {
  const { policy } = record.manifest;
  if (policy.recoveryOrder !== undefined || policy.recoveryStrategy === undefined) return undefined;
  const latest = record.failures.at(-1);
  if (latest?.attempt !== record.attempt || latest.agents?.length !== 1) return undefined;
  const timeout = latest.reason === "PROVIDER_TIMEOUT";
  const rejected =
    latest.reason === "VERDICT_REJECTED" &&
    record.attempt >= 2 &&
    record.attempt === policy.maxAttempts - 1 &&
    record.recoveryFeedback.some(({ attempt }) => attempt === latest.attempt);
  if (!timeout && !rejected) return undefined;
  const agent = latest.agents[0];
  const domain = agent === undefined ? undefined : registry.agentFailureDomains?.[agent];
  return typeof domain === "string" && domain.length > 0 ? domain : undefined;
}

export function preferredRecoveryStrategy(record: TaskRecord): RecoveryStrategy | undefined {
  const policy = record.manifest.policy;
  if (policy.recoveryOrder !== undefined) return undefined;
  if (policy.recoveryStrategy === undefined) return undefined;
  const latest = record.recoveryFeedback.at(-1);
  const rejection = record.failures.at(-1)?.reason;
  const repeat =
    latest !== undefined &&
    record.recoveryFeedback
      .slice(0, -1)
      .some(({ artifactHash }) => artifactHash === latest.artifactHash);
  const rebuild =
    rejection === "VERDICT_REJECTED" &&
    (repeat ||
      (latest !== undefined &&
        (latest.executionErrors > 0 ||
          (latest.heldOutFailures > 0 && latest.publicFailedCaseIds.length === 0))));
  return rebuild ? "rebuild" : policy.recoveryStrategy;
}
