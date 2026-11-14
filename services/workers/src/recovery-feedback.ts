import {
  canonicalJson,
  digestText,
  type RecoveryFeedback,
  type RepairTaskBrief,
  type RecoveryStrategy,
} from "@backstop/shared";
import { publicRun } from "./diagnosis.js";

export function repairFeedback(
  source: string,
  task: RepairTaskBrief,
  feedback: readonly RecoveryFeedback[],
): string[] {
  const last = feedback.at(-1);
  if (last === undefined || last.artifactHash !== digestText(source)) return [];
  const failed = publicRun(source, task).failing.slice(0, 2);
  const examples = failed.map(
    ({ input, expected, actual }) =>
      `Public verification failed on ${canonicalJson(input).slice(0, 240)}: expected ${canonicalJson(expected).slice(0, 160)}, got ${canonicalJson(actual).slice(0, 160)}.`,
  );
  return [
    `The verifier rejected this exact checkpoint on attempt ${String(last.attempt)}. It found ${String(last.heldOutFailures)} held-out failures and ${String(last.executionErrors)} execution errors. Check the input shape and function signature before changing the algorithm.`,
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
