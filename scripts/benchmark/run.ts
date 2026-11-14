import { repairPrompt, type ModelConfig } from "@backstop/agents";
import { digestText, seededRandom, type FailureReason } from "@backstop/shared";
import { check, type PreparedTask } from "./evaluate.js";
import { publicRecoveryExample } from "./held-out.js";
import { infer, limits, type Inference } from "./inference.js";
import { runIsolated } from "@backstop/verifier";
import {
  accounting,
  choose,
  fundedLedger,
  standbyBids,
  type Assignment,
  type Mode,
} from "./schedule.js";

export const legacyFaults = [
  "healthy",
  "transient-tool",
  "worker-death",
  "incorrect-output",
] as const;
export const faults = [...legacyFaults, "constrained-recovery"] as const;
export type Fault = (typeof faults)[number];

type Attempt = {
  readonly number: number;
  readonly assignment: Assignment["bids"];
  readonly agent: string;
  readonly inference: (Omit<Inference, "source"> & { readonly provider: string }) | null;
  readonly result: string;
  readonly sourceHash: string | null;
  readonly checkpointBefore: string;
  readonly checkpointAfter: string;
};

const priorities: Readonly<Record<string, string>> = {
  alpha: "Plan carefully from the current source and validate boundary cases.",
  beta: "Keep the patch small and repair the precise failing invariant.",
  gamma: "Inspect the prior checkpoint and diagnose interacting requirements before patching.",
  epsilon: "Look for a different algorithm when the earlier patch cannot satisfy all rules.",
};
const standbyPrompt =
  "Re-derive the implementation from the published rules. Reason aloud internally about termination at capacity and equality at boundaries. Check any supplied counterexample before submitting.";

function candidateAfterFault(
  fault: Fault,
  attempt: number,
  source: string | null,
  task: PreparedTask,
) {
  if (attempt !== 1) return { source, fault: null };
  switch (fault) {
    case "transient-tool":
      return { source: null, fault: "injected-transient-tool-loss" };
    case "constrained-recovery":
    case "worker-death":
      return { source, fault: "injected-worker-death-after-checkpoint" };
    case "incorrect-output":
      return { source: task.mutant, fault: "injected-incorrect-output" };
    default:
      return { source, fault: null };
  }
}

export async function runTrial(
  config: ModelConfig,
  task: PreparedTask,
  mode: Mode,
  fault: Fault,
  repeat: number,
  seed: number,
  matched?: {
    readonly secondary: ModelConfig | null;
    readonly initial: (request: () => Promise<Inference>) => Promise<Inference>;
    readonly standbyAndFeedback?: boolean;
    readonly freshRetest?: boolean;
  },
) {
  const began = performance.now();
  let deadline = began + limits.wallMs;
  let reusedInferenceMs = 0;
  const ledger = fundedLedger();
  const failures: FailureReason[] = [];
  const excluded: string[] = [];
  const history: string[] = [];
  const improved = matched?.standbyAndFeedback === true;
  const recoveryExample = improved
    ? publicRecoveryExample(task.id, matched.freshRetest === true)
    : undefined;
  const taskId = `bench-${task.id}-${fault}-${String(repeat)}`;
  const standby =
    improved && matched?.secondary !== null && mode !== "single"
      ? standbyBids(taskId, ledger, limits.calls - 1)
      : [];
  const attempts: Attempt[] = [];
  const random = seededRandom(
    (seed ^ Number.parseInt(digestText(task.id).slice(7, 15), 16) ^ repeat) >>> 0,
  );
  const providers = { alpha: 0, beta: 0, gamma: 1, delta: 1, epsilon: 2 };
  const simulatedOutage = Math.floor(random() * 3);
  const unavailable =
    fault === "constrained-recovery"
      ? Object.entries(providers)
          .filter(([, provider]) => provider === (matched?.secondary ? 0 : simulatedOutage))
          .map(([agent]) => agent)
      : [];
  const costBps = Object.fromEntries(
    Object.keys(providers).map((agent) => [agent, 5_000 + Math.floor(random() * 15_001)]),
  );

  let checkpoint = task.starter;
  let winner: Assignment | null = null;
  let accepted = false;
  let correct = false;
  let deliveredSource: string | null = null;
  let terminal = "attempt-cap";
  let rejects = 0;
  for (let attempt = 1; attempt <= limits.calls; attempt++) {
    const msLeft = Math.floor(deadline - performance.now());
    if (msLeft <= 0) {
      terminal = "wall-deadline";
      break;
    }
    const checkpointBefore = digestText(checkpoint);
    const workSource = improved && rejects >= 2 ? task.starter : checkpoint;
    const failingCases = check(workSource, task.entry, task.visible);
    const assignment = choose(mode, ledger, {
      taskId,
      attempt,
      failures,
      excluded,
      unavailable: attempt === 1 ? [] : unavailable,
      costBps,
      failingCases: failingCases.length,
      publicCases: task.visible.length,
      msLeft,
      ...(standby[attempt - 2] === undefined ? {} : { standby: standby[attempt - 2] }),
    });
    if (assignment.lead === "") {
      terminal = "no-assignment";
      attempts.push({
        number: attempt,
        assignment: assignment.bids,
        agent: "",
        inference: null,
        result: terminal,
        sourceHash: null,
        checkpointBefore,
        checkpointAfter: checkpointBefore,
      });
      break;
    }
    const publicExample = rejects > 0 ? recoveryExample : undefined;
    const expected =
      publicExample === undefined
        ? undefined
        : runIsolated(task.reference, task.entry, [publicExample])[0];
    if (publicExample !== undefined && expected?.ok !== true)
      throw new Error("Invalid recovery example");
    const publicCases =
      publicExample !== undefined && expected?.ok === true
        ? [
            ...task.visible,
            {
              id: "recovery-example",
              visibility: "public" as const,
              input: publicExample,
              expected: expected.value,
            },
          ]
        : task.visible;
    const isStandby = assignment.lead.startsWith("standby-");
    const diagnosis = {
      from: "public test runner",
      finding: {
        failingCases:
          publicCases === task.visible ? failingCases : check(workSource, task.entry, publicCases),
        notes: "The current source was tested on the public examples.",
      },
    };
    const messages = repairPrompt({
      objective: `${task.objective} ${isStandby ? standbyPrompt : (priorities[assignment.lead] ?? "")}`,
      rules: task.rules,
      brokenSource: workSource,
      resumedFrom: workSource === task.starter ? null : checkpointBefore,
      suite: { ...task.suite, cases: publicCases },
      generic: true,
      validatedSubtasks: task.visible.flatMap(({ id }) =>
        failingCases.some((testCase) => testCase.id === id) ? [] : [id],
      ),
      failureHistory: history,
      diagnosis,
    });
    const provider =
      (unavailable.includes("alpha") && attempt > 1) || isStandby
        ? (matched?.secondary ?? config)
        : assignment.lead === "gamma" || assignment.lead === "epsilon"
          ? (matched?.secondary ?? config)
          : config;
    const request = () => infer(provider, messages, deadline);
    const started = performance.now();
    const { source, ...inference } =
      matched !== undefined && attempt === 1 ? await matched.initial(request) : await request();
    if (matched !== undefined && attempt === 1) {
      reusedInferenceMs = inference.elapsedMs - (performance.now() - started);
      deadline -= reusedInferenceMs;
    }
    const candidate = candidateAfterFault(fault, attempt, source, task);
    const staged = candidate.source;
    if (staged !== null) checkpoint = staged;
    let result = inference.status;
    let reason: FailureReason = "LEASE_EXPIRED";
    if (
      candidate.fault === "injected-worker-death-after-checkpoint" ||
      candidate.fault === "injected-transient-tool-loss"
    ) {
      result = candidate.fault;
    } else if (staged !== null) {
      const acceptanceFailures = check(staged, task.entry, task.acceptance);
      if (acceptanceFailures.length === 0 && performance.now() <= deadline) {
        accepted = true;
        correct = check(staged, task.entry, task.audit).length === 0;
        winner = assignment;
        deliveredSource = staged;
        result = correct ? "correct-acceptance" : "incorrect-acceptance";
        terminal = result;
      } else {
        reason = "VERDICT_REJECTED";
        result = performance.now() > deadline ? "wall-deadline" : "verifier-rejected";
        if (result === "verifier-rejected") {
          rejects++;
          if (improved && staged === workSource)
            history.push(
              "The last submission repeated the same source and failed. Change the algorithm or boundary condition.",
            );
        }
      }
    }
    attempts.push({
      number: attempt,
      assignment: assignment.bids,
      agent: assignment.lead,
      inference: { ...inference, provider: new URL(provider.baseUrl).hostname },
      result,
      sourceHash: staged === null ? null : digestText(staged),
      checkpointBefore,
      checkpointAfter: digestText(checkpoint),
    });
    if (accepted) break;
    history.push(
      result === "verifier-rejected"
        ? recoveryExample !== undefined
          ? "The verifier rejected the patch. Check the provided public boundary example and handle the entire class of cases it represents."
          : "The independent verifier found a mismatch on undisclosed cases. Reconsider all edge cases against the specification."
        : result,
    );
    failures.push(reason);
    if (mode !== "single" && result !== "injected-transient-tool-loss")
      excluded.push(assignment.lead);
  }
  return {
    task: task.id,
    mode,
    fault,
    repeat,
    unavailableDuringRecovery: unavailable,
    costBps,
    correct,
    accepted,
    terminal,
    elapsedMs: Math.round(performance.now() - began + reusedInferenceMs),
    attempts,
    deliveredSource,
    ...accounting(ledger, winner, winner !== null && attempts.length === 1),
  };
}

export type Trial = Awaited<ReturnType<typeof runTrial>>;
