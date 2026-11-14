import { canonicalJson, testSuiteSchema, type FailingCase, type SuiteCase } from "@backstop/shared";
import { runIsolated } from "@backstop/verifier";
import type { TaskDefinition, Value } from "./tasks.js";

function makeCases(task: TaskDefinition, name: string, inputs: readonly Value[]): SuiteCase[] {
  const results = runIsolated(task.reference, task.entry, inputs);
  return inputs.map((input, index) => {
    const result = results[index];
    if (result?.ok !== true)
      throw new Error(`Reference ${task.id} failed on ${name} ${String(index)}`);
    return {
      id: `${name}-${String(index + 1)}`,
      visibility: name === "public" ? "public" : "held_out",
      input,
      expected: result.value,
    };
  });
}

export function check(source: string, entry: string, cases: readonly SuiteCase[]): FailingCase[] {
  const results = runIsolated(
    source,
    entry,
    cases.map(({ input }) => input),
  );
  return cases.flatMap(({ id, input, expected }, index) => {
    const result = results[index];
    if (result?.ok === true && canonicalJson(result.value) === canonicalJson(expected)) return [];
    const actual = result?.ok === true ? result.value : (result?.error ?? "no outcome");
    const safeActual =
      canonicalJson(actual).length > 400 ? "result exceeded feedback limit" : actual;
    return [{ id, input, expected, actual: safeActual }];
  });
}

export function prepare(task: TaskDefinition) {
  const visible = makeCases(task, "public", task.visible);
  const acceptance = [...visible, ...makeCases(task, "acceptance", task.acceptance)];
  const audit = makeCases(task, "audit", task.audit);
  const actualAnchors = makeCases(
    task,
    "anchor",
    task.anchors.map(([input]) => input),
  );
  if (
    task.anchors.some(
      ([, expected], index) =>
        canonicalJson(expected) !== canonicalJson(actualAnchors[index]?.expected),
    )
  ) {
    throw new Error(`Hand-calculated anchors disagree with the reference for ${task.id}`);
  }
  if (check(task.starter, task.entry, acceptance).length === 0)
    throw new Error(`Starter already passes ${task.id}`);
  if (
    check(task.mutant, task.entry, visible).length > 0 ||
    check(task.mutant, task.entry, [...acceptance, ...audit]).length === 0
  ) {
    throw new Error(`Fault must pass public cases yet violate ${task.id}`);
  }
  const suite = testSuiteSchema.parse({
    suiteId: task.id,
    entry: task.entry,
    oracleSource: task.reference,
    cases: acceptance,
  });
  return { ...task, visible, acceptance, audit, suite };
}

export type PreparedTask = ReturnType<typeof prepare>;
