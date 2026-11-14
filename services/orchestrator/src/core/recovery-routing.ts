import type { RecoveryStrategy } from "@backstop/shared";
import type { TaskRecord } from "./record.js";

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
