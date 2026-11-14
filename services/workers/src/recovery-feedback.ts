import {
  canonicalJson,
  digestText,
  type RecoveryFeedback,
  type RepairTaskBrief,
  type RecoveryStrategy,
  type FailingCase,
} from "@backstop/shared";
import { publicRun } from "./diagnosis.js";

function repeatedPublicFailure(a: RecoveryFeedback, b: RecoveryFeedback): boolean {
  return (
    a.publicFailedCaseIds.length > 0 &&
    canonicalJson(a.publicFailedCaseIds.toSorted()) ===
      canonicalJson(b.publicFailedCaseIds.toSorted()) &&
    a.executionErrors === b.executionErrors
  );
}

export function repairFeedback(
  source: string,
  task: RepairTaskBrief,
  feedback: readonly RecoveryFeedback[],
  publicFailures?: readonly FailingCase[],
): string[] {
  const last = feedback.at(-1);
  if (last === undefined || last.artifactHash !== digestText(source)) return [];
  const failed = (publicFailures ?? publicRun(source, task).failing).slice(0, 2);
  const examples = failed.map(
    ({ input, expected, actual }) =>
      `Public verification failed on ${canonicalJson(input).slice(0, 240)}: expected ${canonicalJson(expected).slice(0, 160)}, got ${canonicalJson(actual).slice(0, 160)}.`,
  );
  return [
    `The verifier rejected this exact checkpoint on attempt ${String(last.attempt)}. It found ${String(last.heldOutFailures)} held-out failures and ${String(last.executionErrors)} execution errors. Check the input shape and function signature before changing the algorithm.`,
    ...(feedback.slice(0, -1).some((previous) => repeatedPublicFailure(previous, last))
      ? [
          "The same public checks failed in earlier implementations. Change the underlying algorithm or output transformation; rearranging the same logic is not a repair.",
        ]
      : []),
    ...examples,
  ];
}

export function rebuildInstruction(strategy: RecoveryStrategy | undefined): string[] {
  return strategy === "rebuild"
    ? [
        "Treat rejected code as evidence of the failure. Write an independent implementation from the rules and verify edge cases before returning it.",
      ]
    : [];
}

export function recoveryStrategyFor(
  source: string,
  feedback: readonly RecoveryFeedback[],
  offered: RecoveryStrategy | undefined,
): RecoveryStrategy | undefined {
  const last = feedback.at(-1);
  if (last === undefined || last.artifactHash !== digestText(source)) return offered;
  const repeated = feedback
    .slice(0, -1)
    .some(
      (previous) =>
        previous.artifactHash === last.artifactHash || repeatedPublicFailure(previous, last),
    );
  return repeated ||
    last.executionErrors > 0 ||
    (last.heldOutFailures > 0 && last.publicFailedCaseIds.length === 0)
    ? "rebuild"
    : offered;
}
