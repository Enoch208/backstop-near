import {
  proposeRepair,
  workFor,
  type Diagnosis,
  type FixtureAgent,
  type ModelConfig,
} from "@backstop/agents";
import { candidate, checkoutRules, checkoutSuite } from "@backstop/fixture-checkout";
import {
  canonicalJson,
  digestText,
  type Digest,
  type RepairTaskBrief,
  type RecoveryStrategy,
} from "@backstop/shared";
import type { InferenceReceipt } from "@backstop/tee";
import { probeRepair, publicRun, publicDiagnosis } from "./diagnosis.js";

export type Product = {
  readonly label: string;
  readonly source: string;
  readonly artifactHash: Digest;
  readonly uri: string;
  readonly validatedSubtasks: readonly string[];
  readonly completes: boolean;
  readonly inference: InferenceReceipt | null;
  readonly unsigned: string | null;
};

export type Resume = { readonly source: string; readonly hash: Digest };

export type WorkContext = {
  readonly objective: string;
  readonly inherited: readonly string[];
  readonly history: readonly string[];
  readonly resume: Resume | null;
  readonly diagnosis: Diagnosis | null;
  readonly repairTask?: RepairTaskBrief;
  readonly recoveryStrategy?: RecoveryStrategy;
};

export function publicFailures(
  source: string,
  repairTask?: RepairTaskBrief,
): { passed: string[]; failures: string[] } {
  const run = publicRun(source, repairTask);
  return {
    passed: run.passed,
    failures: run.failing.map(
      (failing) =>
        `${failing.id}: input ${canonicalJson(failing.input)} expected ${canonicalJson(failing.expected)} but got ${canonicalJson(failing.actual)}`,
    ),
  };
}

export async function produce(
  agent: FixtureAgent,
  model: ModelConfig | null,
  context: WorkContext,
): Promise<Product> {
  const repairTask = context.repairTask;
  if (repairTask !== undefined && model === null)
    throw new Error("User-supplied repairs require a model");
  if (model === null || (repairTask === undefined && agent.role === "executor")) {
    const { plan, artifact } = workFor(agent.agentId);
    return {
      label: `${artifact.name} (fixture patch)`,
      source: artifact.source,
      artifactHash: artifact.artifactHash,
      uri: `fixture://checkout/candidates/${artifact.name}.js`,
      validatedSubtasks: plan.validatedSubtasks,
      completes: plan.completes,
      inference: null,
      unsigned: null,
    };
  }
  const milestone = agent.role === "executor" ? repairTask?.primaryMilestone : undefined;
  const task =
    milestone === undefined || repairTask === undefined
      ? repairTask
      : {
          ...repairTask,
          suite: {
            ...repairTask.suite,
            cases: repairTask.suite.cases.filter((testCase) =>
              milestone.publicCaseIds.includes(testCase.id),
            ),
          },
        };
  const brief = {
    objective: milestone?.objective ?? context.objective,
    rules: milestone?.rules ?? task?.rules ?? checkoutRules,
    brokenSource: context.resume?.source ?? task?.source ?? candidate("original").source,
    resumedFrom: context.resume?.hash ?? null,
    suite: task?.suite ?? checkoutSuite,
    generic: task !== undefined,
    validatedSubtasks: context.inherited,
    diagnosis:
      context.diagnosis ??
      (task === undefined ? null : publicDiagnosis(context.resume?.source ?? task.source, task)),
    ...(context.recoveryStrategy === undefined
      ? {}
      : { recoveryStrategy: context.recoveryStrategy }),
  };
  let history = [...context.history];
  let repair = await proposeRepair(model, { ...brief, failureHistory: history });
  let check = publicFailures(repair.source, task);
  if (check.failures.length > 0) {
    history = [...history, `your own public test run failed: ${check.failures.join("; ")}`];
    repair = await proposeRepair(model, {
      ...brief,
      brokenSource: repair.source,
      resumedFrom: digestText(repair.source),
      failureHistory: history,
      diagnosis: null,
    });
    check = publicFailures(repair.source, task);
  }
  if (check.failures.length > 0)
    throw new Error(
      `The repair still fails public verification after the bounded retry: ${check.failures.join("; ").slice(0, 2_000)}`,
    );
  if (milestone !== undefined && task !== undefined) {
    const start = publicFailures(brief.brokenSource, task);
    const remaining = probeRepair(repair.source, task);
    if (
      check.failures.length > 0 ||
      check.passed.length <= start.passed.length ||
      remaining === null
    ) {
      throw new Error("The model did not produce the specified partial improvement");
    }
  }
  const signed = repair.receipt === null ? "unsigned" : "TEE-signed";
  return {
    label: `a ${signed} live patch from ${model.model} passing ${String(check.passed.length)} public cases`,
    source: repair.source,
    inference: repair.receipt,
    unsigned: repair.unsigned,
    artifactHash: digestText(repair.source),
    uri: `live-ai://${model.model}`,
    validatedSubtasks: check.passed.map((id) => `public:${id}`),
    completes: milestone === undefined,
  };
}
