import { searchCounterexample, type Diagnosis } from "@backstop/agents";
import { checkoutSuite } from "@backstop/fixture-checkout";
import {
  canonicalJson,
  findingHash,
  publicView,
  type Digest,
  type FailingCase,
  type Finding,
} from "@backstop/shared";
import { runInSandbox } from "@backstop/verifier";
import type { ApiClient } from "./client.js";
import { findingReplySchema } from "./messages.js";
import type { Resume } from "./produce.js";

export type PublicRun = { readonly passed: string[]; readonly failing: FailingCase[] };

export function publicRun(source: string): PublicRun {
  const cases = publicView(checkoutSuite).cases;
  const results = runInSandbox(
    source,
    checkoutSuite.entry,
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

export function diagnose(taskId: string, attempt: number, agentId: string, code: Resume): Finding {
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
