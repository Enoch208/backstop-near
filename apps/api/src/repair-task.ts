import {
  canonicalJson,
  publicView,
  type RepairTask,
  type RepairTaskBrief,
  type TaskManifest,
} from "@backstop/shared";
import { runIsolated } from "@backstop/verifier";
import type { Runtime } from "./runtime.js";

export function repairTaskFor(runtime: Runtime, manifest: TaskManifest): RepairTask | undefined {
  return manifest.repairTaskHash === undefined
    ? undefined
    : runtime.repairTasks.get(manifest.repairTaskHash);
}

export function repairBrief(task: RepairTask): RepairTaskBrief {
  const { suite, rules, source } = task;
  const inputs = task.challengeInputs ?? [];
  const outcomes = runIsolated(suite.oracleSource, suite.entry, inputs);
  const probes = inputs.map((input, index) => {
    const result = outcomes[index];
    if (result?.ok !== true) throw new TypeError("The repair oracle refused a challenge input");
    return { input, expected: result.value };
  });
  return {
    source,
    rules,
    suite: { suiteId: suite.suiteId, entry: suite.entry, cases: publicView(suite).cases },
    probes,
    ...(task.primaryMilestone === undefined ? {} : { primaryMilestone: task.primaryMilestone }),
  };
}

export function invalidRepairTask(task: RepairTask): string | null {
  const { suite } = task;
  const inputs = [
    ...suite.cases.map((testCase) => testCase.input),
    ...(task.challengeInputs ?? []),
  ];
  const results = runIsolated(suite.oracleSource, suite.entry, inputs);
  for (const [index, result] of results.entries()) {
    if (!result.ok) return "The repair oracle must return JSON for every pinned case and probe";
    const testCase = suite.cases[index];
    if (
      testCase !== undefined &&
      canonicalJson(result.value) !== canonicalJson(testCase.expected)
    ) {
      return `The oracle disagrees with case ${testCase.id}`;
    }
    if (canonicalJson(result.value).length > 16_000) return "The repair oracle output is too large";
  }
  return null;
}
