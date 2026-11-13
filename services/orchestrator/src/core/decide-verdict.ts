import {
  fail,
  isAuthenticEvidence,
  isAuthenticRuling,
  succeed,
  type ChallengeRuling,
  type EvidenceBundle,
  type FailureReason,
  type SignedChallengeRuling,
} from "@backstop/shared";
import type { Decision, DecisionContext } from "./commands.js";
import type { TaskEventBody } from "./events.js";
import type { TaskRecord } from "./record.js";
import { afterFailure, assignedAgents } from "./recovery.js";

function rejectAttempt(
  record: TaskRecord,
  nowMs: number,
  reason: FailureReason,
  ruling: ChallengeRuling | null,
): TaskEventBody[] {
  const withFailure = {
    ...record,
    failures: [...record.failures, { attempt: record.attempt, reason }],
  };
  return [
    {
      type: "attempt_rejected",
      attempt: record.attempt,
      reason,
      ruling,
      agents: assignedAgents(record),
    },
    afterFailure(withFailure, nowMs),
  ];
}

function evidenceMismatch(record: TaskRecord, evidence: EvidenceBundle): string | null {
  const candidate = record.candidate;
  const body = evidence.body;
  if (candidate === null) return "There is no submitted artifact";
  if (body.taskId !== record.taskId || body.attempt !== candidate.attempt)
    return "Evidence is for another attempt";
  if (body.fencingToken !== candidate.fencingToken) return "Evidence names a stale fencing token";
  if (body.artifactHash !== candidate.artifactHash) return "Evidence is for another artifact";
  if (body.suiteHash !== record.manifest.suite.suiteHash) return "Evidence used another test suite";
  if (body.runnerId !== record.manifest.suite.runnerId) return "Evidence used another runner";
  if (body.policyHash !== record.manifestHash) return "Evidence names another task policy";
  return null;
}

export function decideVerification(
  record: TaskRecord,
  evidence: EvidenceBundle,
  context: DecisionContext,
): Decision {
  if (record.state !== "VERIFYING")
    return fail("INVALID_TRANSITION", `Nothing to verify in ${record.state}`);
  if (record.candidate?.evidence) return fail("DUPLICATE", "This artifact already has a verdict");
  if (!isAuthenticEvidence(evidence, context.registry.verifierPublicKey)) {
    return fail("BAD_SIGNATURE", "Evidence is not signed by the authorized verifier");
  }
  const mismatch = evidenceMismatch(record, evidence);
  if (mismatch !== null) return fail("STALE_LEASE", mismatch);
  if (evidence.body.verdict === "REJECT") {
    return succeed([
      { type: "verification_recorded", evidence, challengeDeadlineMs: null },
      ...rejectAttempt(record, context.nowMs, "VERDICT_REJECTED", null),
    ]);
  }
  const challengeDeadlineMs = context.nowMs + record.manifest.policy.challengeWindowMs;
  return succeed([{ type: "verification_recorded", evidence, challengeDeadlineMs }]);
}

export function decideChallenge(
  record: TaskRecord,
  signed: SignedChallengeRuling,
  context: DecisionContext,
): Decision {
  if (!isAuthenticRuling(signed, context.registry.verifierPublicKey)) {
    return fail("BAD_SIGNATURE", "Only the verifier's own re-run can rule on a challenge");
  }
  const ruling = signed.ruling;
  const deadline = record.candidate?.challengeDeadlineMs ?? null;
  if (record.state !== "VERIFYING" || deadline === null) {
    return fail("INVALID_TRANSITION", "No provisional pass is open to challenge");
  }
  if (context.nowMs > deadline)
    return fail("CHALLENGE_WINDOW_CLOSED", "The challenge window closed");
  if (ruling.attempt !== record.attempt || ruling.artifactHash !== record.candidate?.artifactHash) {
    return fail("STALE_STATE", "The challenge targets another artifact");
  }
  if (!ruling.upheld) return succeed([{ type: "challenge_dismissed", ruling }]);
  return succeed(rejectAttempt(record, context.nowMs, "CHALLENGE_UPHELD", ruling));
}

export function decideCloseChallengeWindow(record: TaskRecord, context: DecisionContext): Decision {
  const candidate = record.candidate;
  if (record.state !== "VERIFYING" || candidate?.evidence?.body.verdict !== "ACCEPT") {
    return fail("INVALID_TRANSITION", "No provisional pass is waiting");
  }
  if (candidate.challengeDeadlineMs === null || context.nowMs <= candidate.challengeDeadlineMs) {
    return fail("POLICY_VIOLATION", "The challenge window is still open");
  }
  return succeed([
    {
      type: "task_accepted",
      attempt: candidate.attempt,
      evidenceHash: candidate.evidence.evidenceHash,
    },
  ]);
}
