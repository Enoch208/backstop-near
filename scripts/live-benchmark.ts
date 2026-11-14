import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { modelFromEnv } from "@backstop/agents";
import { digestOf, seededRandom } from "@backstop/shared";
import { prepare } from "./benchmark/evaluate.js";
import { limits } from "./benchmark/inference.js";
import { results } from "./benchmark/report.js";
import { faults, legacyFaults, runTrial, type Trial } from "./benchmark/run.js";
import { modes } from "./benchmark/schedule.js";
import { recoveryTasks, tasks } from "./benchmark/tasks.js";
import { verifyRun } from "./benchmark/verify-run.js";

const { values } = parseArgs({
  options: {
    "verify-corpus": { type: "boolean", default: false },
    "verify-run": { type: "string" },
    pilot: { type: "boolean", default: false },
    repeats: { type: "string", default: "1" },
    seed: { type: "string", default: "20261114" },
    out: { type: "string" },
  },
  strict: true,
});
const numeric = (raw: string, name: string, minimum: number, maximum: number): number => {
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `Invalid ${name}, expected an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  return value;
};

const prepared = recoveryTasks.map(prepare);
const corpusHash = digestOf(recoveryTasks);
if (values["verify-run"] !== undefined) {
  const { trials, deliveries } = verifyRun(values["verify-run"], [
    { tasks: prepared, hash: corpusHash, faults },
    { tasks: tasks.map(prepare), hash: digestOf(tasks), faults: legacyFaults },
  ]);
  process.stdout.write(
    `Confirmed pairing for ${String(trials)} recorded trials and independently rechecked ${String(deliveries)} delivered artifacts.\n`,
  );
} else if (values["verify-corpus"]) {
  process.stdout.write(
    `Verified ${String(prepared.length)} reference implementations, hand-calculated anchors, broken starters, and incorrect-output injections.\nCorpus ${corpusHash}\n`,
  );
} else {
  if (existsSync(".env")) process.loadEnvFile();
  const config = modelFromEnv(process.env);
  if (config === null)
    throw new Error(
      "Set BACKSTOP_AI_API_KEY in the environment or .env before running live inference.",
    );
  const selected = values.pilot ? prepared.slice(0, 2) : prepared;
  const repeats = numeric(values.repeats, "repeats", 1, 20);
  const seed = numeric(values.seed, "seed", 1, 4_294_967_295);
  const random = seededRandom(seed);
  const output =
    values.out ??
    (values.pilot ? "benchmarks/market-pilot.json" : "benchmarks/market-results.json");
  const trials: Trial[] = [];
  const blocks = selected
    .flatMap((task) =>
      faults.flatMap((fault) =>
        Array.from({ length: repeats }, (_, index) => ({
          task,
          fault,
          repeat: index + 1,
          order: random(),
          modes: modes.map((mode) => ({ mode, order: random() })).sort((a, b) => a.order - b.order),
        })),
      ),
    )
    .sort((a, b) => a.order - b.order);
  const startedAt = new Date().toISOString();
  const save = () => {
    const report = {
      benchmark: "Backstop in-process recovery scheduler evaluation with live model inference",
      pilot: values.pilot,
      startedAt,
      recordedAt: new Date().toISOString(),
      corpusHash,
      model: config.model,
      node: process.version,
      seed,
      repeats,
      limits,
      expectedTrials: blocks.length * modes.length,
      completedTrials: trials.length,
      costModel:
        "Simulation using real Backstop payout planning. Provider token usage is reported only when supplied by the provider.",
      evidenceScope:
        "Injected worker and tool outcomes, isolated function tests, and the in-process auction. No worker processes, TEE receipt checks, or NEAR transactions.",
      ...results(trials, seed),
      trials,
    };
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  };
  mkdirSync(dirname(output), { recursive: true });
  save();
  process.stdout.write(
    `Running ${String(blocks.length * modes.length)} trials with ${config.model}. At most ${String(blocks.length * modes.length * limits.calls)} calls.\n`,
  );
  for (const block of blocks) {
    for (const { mode } of block.modes) {
      const trial = await runTrial(config, block.task, mode, block.fault, block.repeat, seed);
      trials.push(trial);
      save();
      process.stdout.write(
        `${trial.task} ${trial.fault} ${mode} ${trial.terminal} (${String(trial.attempts.length)} attempts)\n`,
      );
    }
  }
  process.stdout.write(`Results saved to ${output}\n`);
}
