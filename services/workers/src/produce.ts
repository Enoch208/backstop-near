import { proposeRepair, workFor, type FixtureAgent, type ModelConfig } from "@backstop/agents";
import { candidate, checkoutRules, checkoutSuite } from "@backstop/fixture-checkout";
import { canonicalJson, digestText, publicView, type Digest } from "@backstop/shared";
import type { InferenceReceipt } from "@backstop/tee";
import { runInSandbox } from "@backstop/verifier";

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

export type WorkContext = {
  readonly objective: string;
  readonly inherited: readonly string[];
  readonly history: readonly string[];
};

function publicFailures(source: string): { passed: string[]; failures: string[] } {
  const cases = publicView(checkoutSuite).cases;
  const results = runInSandbox(
    source,
    checkoutSuite.entry,
    cases.map((testCase) => testCase.input),
  );
  const outcomes = cases.map((testCase, index) => {
    const result = results[index];
    const ok =
      result?.ok === true && canonicalJson(result.value) === canonicalJson(testCase.expected);
    const got =
      result === undefined ? "nothing" : result.ok ? canonicalJson(result.value) : result.error;
    return {
      id: testCase.id,
      ok,
      detail: `${testCase.id} expected ${canonicalJson(testCase.expected)} but got ${got}`,
    };
  });
  return {
    passed: outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.id),
    failures: outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.detail),
  };
}

export async function produce(
  agent: FixtureAgent,
  model: ModelConfig | null,
  context: WorkContext,
): Promise<Product> {
  if (model === null || agent.role === "executor") {
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
  const brief = {
    objective: context.objective,
    rules: checkoutRules,
    brokenSource: candidate("original").source,
    suite: checkoutSuite,
    validatedSubtasks: context.inherited,
  };
  let history = [...context.history];
  let repair = await proposeRepair(model, { ...brief, failureHistory: history });
  let check = publicFailures(repair.source);
  if (check.failures.length > 0) {
    history = [...history, `your own public test run failed: ${check.failures.join("; ")}`];
    repair = await proposeRepair(model, { ...brief, failureHistory: history });
    check = publicFailures(repair.source);
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
    completes: true,
  };
}
