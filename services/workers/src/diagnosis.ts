import { searchCounterexample, type Diagnosis } from "@backstop/agents";
import { checkoutSuite } from "@backstop/fixture-checkout";
import {
  canonicalJson,
  findingHash,
  publicView,
  type Digest,
  type FailingCase,
  type Finding,
  type RepairTaskBrief,
} from "@backstop/shared";
import { runInSandbox, runIsolated } from "@backstop/verifier";
import type { ApiClient } from "./client.js";
import { findingReplySchema } from "./messages.js";
import type { Resume } from "./produce.js";

export type PublicRun = { readonly passed: string[]; readonly failing: FailingCase[] };

export function publicRun(source: string, repairTask?: RepairTaskBrief): PublicRun {
  const suite = repairTask?.suite ?? checkoutSuite;
  const cases = publicView(suite).cases;
  const run = repairTask === undefined ? runInSandbox : runIsolated;
  const results = run(
    source,
    suite.entry,
    cases.map((testCase) => testCase.input),
  );
  const passed: string[] = [];
  const failing: FailingCase[] = [];
  for (const [index, testCase] of cases.entries()) {
    const result = results[index];
    const ok =
      result?.ok === true && canonicalJson(result.value) === canonicalJson(testCase.expected);
    if (ok) passed.push(testCase.id);
    else
      failing.push({
        id: testCase.id,
        input: testCase.input,
        expected: testCase.expected,
        actual: result === undefined ? "nothing" : result.ok ? result.value : result.error,
      });
  }
  return { passed, failing };
}

export function probeRepair(source: string, task: RepairTaskBrief) {
  const results = runIsolated(
    source,
    task.suite.entry,
    task.probes.map((probe) => probe.input),
  );
  for (const [index, probe] of task.probes.entries()) {
    const result = results[index];
    if (result?.ok !== true || canonicalJson(result.value) !== canonicalJson(probe.expected)) {
      return {
        id: `probe-${String(index + 1)}`,
        input: probe.input,
        expected: probe.expected,
        actual: result === undefined ? "No result" : result.ok ? result.value : result.error,
      };
    }
  }
  return null;
}

export function diagnose(
  taskId: string,
  attempt: number,
  agentId: string,
  code: Resume,
  repairTask?: RepairTaskBrief,
): Finding {
  if (repairTask !== undefined) {
    const run = publicRun(code.source, repairTask);
    const probe = probeRepair(code.source, repairTask);
    return {
      failingCases: probe === null ? run.failing : [...run.failing.slice(0, 31), probe],
      notes: `${String(run.passed.length)} of ${String(repairTask.suite.cases.length)} public cases pass on ${code.hash}. Checked the pinned challenge probes separately.`,
    };
  }
  const run = publicRun(code.source);
  const target = {
    taskId,
    attempt,
    artifactHash: code.hash,
    artifactSource: code.source,
    suite: checkoutSuite,
  };
  const search = searchCounterexample(target, agentId, attempt);
  const probe =
    search.ruling === null || search.input === null
      ? []
      : [
          {
            id: `probe-${String(search.probes)}`,
            input: search.input,
            expected: search.ruling.expected,
            actual: search.ruling.actual,
          },
        ];
  const total = run.passed.length + run.failing.length;
  const probed =
    probe.length === 0
      ? `no counterexample in ${String(search.probes)} probes of the published rules`
      : `probe ${String(search.probes)} breaks the published rules`;
  return {
    failingCases: [...run.failing, ...probe],
    notes: `${String(run.passed.length)} of ${String(total)} public cases pass on ${code.hash}; ${probed}.`,
  };
}

export type Posted = {
  readonly attempt: number;
  readonly agentId: string;
  readonly findingHash: Digest;
};

export function findingBoard() {
  const posted: Posted[] = [];
  const waiters = new Set<() => void>();
  const record = (entry: Posted) => {
    posted.push(entry);
    for (const waiter of waiters) waiter();
  };
  const next = (attempt: number, from: readonly string[], timeoutMs: number) =>
    new Promise<Posted | null>((resolve) => {
      const find = () =>
        posted.find((entry) => entry.attempt === attempt && from.includes(entry.agentId));
      const waiter = () => {
        const found = find();
        if (found === undefined) return;
        clearTimeout(timer);
        waiters.delete(waiter);
        resolve(found);
      };
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        resolve(null);
      }, timeoutMs);
      waiters.add(waiter);
      waiter();
    });
  return { record, next };
}

export async function fetchFinding(
  client: ApiClient,
  base: string,
  posted: Posted,
): Promise<Diagnosis | null> {
  const reply = await client.get(`${base}/findings/${posted.findingHash}`);
  const fetched = findingReplySchema.safeParse(reply.body);
  if (!fetched.success || findingHash(fetched.data.finding) !== posted.findingHash) return null;
  return { from: posted.agentId, finding: fetched.data.finding };
}
