import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { modelFromEnv } from "@backstop/agents";
import { digestOf, seededRandom } from "@backstop/shared";
import { blindTasks } from "./benchmark/blind-tasks.js";
import { prepare } from "./benchmark/evaluate.js";
import { loadExternalTasks } from "./benchmark/external-tasks.js";
import { combineDiversityTasks } from "./benchmark/composite-external-tasks.js";
import { combineBoundedTasks } from "./benchmark/bounded-module-tasks.js";
import { limits, type Inference } from "./benchmark/inference.js";
import { benchmarkFaults, createBenchLane } from "./benchmark/live-pair.js";
import { operatorSpecs } from "./benchmark/operator-process.js";
import { verifyStandbyRun } from "./benchmark/verify-standby.js";
import { z } from "zod";

const { values } = parseArgs({
  options: {
    verify: { type: "string" },
    out: { type: "string" },
    state: { type: "string" },
    lanes: { type: "string", default: "4" },
    repeats: { type: "string", default: "2" },
    pilot: { type: "boolean", default: false },
    external: { type: "boolean", default: false },
    routed: { type: "boolean", default: false },
    hardened: { type: "boolean", default: false },
    "fresh-external": { type: "boolean", default: false },
    regression: { type: "boolean", default: false },
    "contract-checks": { type: "boolean", default: false },
    "fresh-contracts": { type: "boolean", default: false },
    "semantic-regression": { type: "boolean", default: false },
    "fresh-semantic": { type: "boolean", default: false },
    diversify: { type: "boolean", default: false },
    "fresh-diversity": { type: "boolean", default: false },
    "composite-diversity": { type: "boolean", default: false },
    bounded: { type: "boolean", default: false },
    "fresh-bounded": { type: "boolean", default: false },
    "resume-from": { type: "string" },
  },
});
if (values.diversify && !values.hardened) throw new Error("--diversify requires --hardened");
if (values.bounded && (!values.hardened || !values.diversify))
  throw new Error("--bounded requires --hardened --diversify");
if (
  values["fresh-bounded"] &&
  (!values.bounded ||
    !values["contract-checks"] ||
    values.regression ||
    values["fresh-diversity"] ||
    values["composite-diversity"] ||
    values["fresh-external"] ||
    values["fresh-contracts"] ||
    values["fresh-semantic"] ||
    values["semantic-regression"])
)
  throw new Error("--fresh-bounded requires --bounded --contract-checks and cannot mix corpora");
if (values["composite-diversity"] && !values["fresh-diversity"])
  throw new Error("--composite-diversity requires --fresh-diversity");
if (
  values["fresh-diversity"] &&
  (!values["contract-checks"] ||
    values.regression ||
    values["fresh-external"] ||
    values["fresh-contracts"] ||
    values["fresh-semantic"] ||
    values["semantic-regression"])
)
  throw new Error("--fresh-diversity requires --contract-checks and cannot mix corpora");
if (values.hardened && (!values.external || !values.routed))
  throw new Error("--hardened requires --external --routed");
if (values["fresh-external"] && (!values.hardened || values.regression))
  throw new Error("--fresh-external requires --hardened and cannot use --regression");
if (values.regression && !values.hardened) throw new Error("--regression requires --hardened");
if (values["contract-checks"] && !values.hardened)
  throw new Error("--contract-checks requires --hardened");
if (
  (values["semantic-regression"] || values["fresh-semantic"]) &&
  (!values["contract-checks"] ||
    values.regression ||
    values["fresh-external"] ||
    values["fresh-contracts"] ||
    (values["semantic-regression"] && values["fresh-semantic"]))
)
  throw new Error("Semantic corpora require --contract-checks and cannot mix corpora");
if (
  values["fresh-contracts"] &&
  (!values["contract-checks"] || values.regression || values["fresh-external"])
)
  throw new Error("--fresh-contracts requires --contract-checks and cannot mix corpora");
const loaded = values.external
  ? await loadExternalTasks(
      values["fresh-external"],
      values.hardened,
      values["contract-checks"],
      values["fresh-contracts"],
      values["semantic-regression"] ? "regression" : values["fresh-semantic"] ? "fresh" : undefined,
      values["fresh-diversity"],
      values["fresh-bounded"],
    )
  : blindTasks;
const definitions = values.regression
  ? loaded.filter(({ id }) =>
      ["he-119", "he-129", "he-132", ...(values["contract-checks"] ? ["he-1"] : [])].includes(id),
    )
  : values["fresh-bounded"]
    ? combineBoundedTasks(loaded)
    : values["composite-diversity"]
      ? combineDiversityTasks(loaded)
      : loaded;
if (values.verify !== undefined) {
  const result = verifyStandbyRun(values.verify, definitions);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}
const laneCount = Number(values.lanes);
if (values.routed && !values.external) throw new Error("--routed requires --external");
const repeats = Number(values.repeats);
if (
  !Number.isSafeInteger(laneCount) ||
  laneCount < 1 ||
  laneCount > 8 ||
  !Number.isSafeInteger(repeats) ||
  repeats < 1 ||
  repeats > 5 ||
  values.out === undefined ||
  values.state === undefined
) {
  throw new Error(
    "Set --out <new JSON path> --state <new SQLite directory> with up to 8 lanes and 5 repeats",
  );
}
if (existsSync(values.out) || existsSync(values.state))
  throw new Error("Use new output and state paths");
if (existsSync(".env")) process.loadEnvFile(".env");
const primary = modelFromEnv(process.env);
const secondary = modelFromEnv({
  BACKSTOP_AI_API_KEY: process.env.BACKSTOP_BENCH_SECOND_API_KEY,
  BACKSTOP_AI_BASE_URL: process.env.BACKSTOP_BENCH_SECOND_BASE_URL,
  BACKSTOP_AI_MODEL: process.env.BACKSTOP_BENCH_SECOND_MODEL,
});
if (
  primary === null ||
  secondary === null ||
  new URL(primary.baseUrl).hostname === new URL(secondary.baseUrl).hostname
)
  throw new Error("Configure two distinct inference providers");

const tasks = definitions.map(prepare);
const seed = 560_831;
const random = seededRandom(seed);
const blocks = (values.pilot ? tasks.slice(0, 1) : tasks)
  .flatMap((task) =>
    benchmarkFaults.flatMap((fault) =>
      Array.from({ length: repeats }, (_, index) => ({
        task,
        fault,
        repeat: index + 1,
        blockOrder: random(),
        marketFirst: random() < 0.5,
      })),
    ),
  )
  .sort((a, b) => a.blockOrder - b.blockOrder);
const expectedTrials = blocks.length * 2;
const startedAt = new Date().toISOString();
type Lane = Awaited<ReturnType<typeof createBenchLane>>;
type Trial = Awaited<ReturnType<Lane["trial"]>>;
const trials: Trial[] = [];
const metadata = {
  startedAt,
  lanes: laneCount,
  implementationHash: digestOf(
    [
      "services/agents/src/live/repair.ts",
      "services/agents/src/live/repair-budget.ts",
      "services/agents/src/live/propose.ts",
      "services/agents/src/pricing.ts",
      "services/workers/src/agent-loop.ts",
      "packages/shared/src/task-state.ts",
      "services/orchestrator/src/core/decide-work.ts",
      "services/orchestrator/src/core/decide.ts",
      "services/orchestrator/src/core/events.ts",
      "apps/api/src/event-schema.ts",
      "apps/api/src/routes/work.ts",
      "apps/api/src/router.ts",
      "services/workers/src/recovery-feedback.ts",
      "services/workers/src/diagnosis.ts",
      "services/orchestrator/src/core/auction.ts",
      "services/orchestrator/src/core/decide-market.ts",
      "services/orchestrator/src/core/recovery-routing.ts",
      "services/orchestrator/src/core/evolve.ts",
      "services/orchestrator/src/core/record.ts",
      "services/orchestrator/src/core/commands.ts",
      "apps/api/src/runtime.ts",
      "scripts/live-standby-benchmark.ts",
      "scripts/benchmark/verify-standby.ts",
      "scripts/benchmark/live-operator.ts",
      "scripts/benchmark/live-pair.ts",
      "scripts/benchmark/operator-process.ts",
      "scripts/benchmark/inference.ts",
      "scripts/benchmark/external-tasks.ts",
      "scripts/benchmark/fresh-external-tasks.ts",
      "scripts/benchmark/contract-external-tasks.ts",
      "scripts/benchmark/semantic-external-tasks.ts",
      "scripts/benchmark/diversity-external-tasks.ts",
      "scripts/benchmark/composite-external-tasks.ts",
      "scripts/benchmark/bounded-external-tasks.ts",
      "scripts/benchmark/bounded-module-tasks.ts",
      "fixtures/checkout/src/manifest.ts",
    ].map((path) => [path, readFileSync(path, "utf8")]),
  ),
  routed: values.routed,
  hardened: values.hardened,
  freshExternal: values["fresh-external"],
  regression: values.regression,
  contractChecks: values["contract-checks"],
  freshContracts: values["fresh-contracts"],
  semanticRegression: values["semantic-regression"],
  freshSemantic: values["fresh-semantic"],
  freshDiversity: values["fresh-diversity"],
  compositeDiversity: values["composite-diversity"],
  diversify: values.diversify,
  bounded: values.bounded,
  freshBounded: values["fresh-bounded"],
  ...(values.bounded
    ? {
        timeoutRouting:
          "prefer independent eligible provider after active worker-reported provider timeout; never infer a provider timeout from lease expiry",
        promptPolicy:
          "budgeted full specification and public tests; compact optional guidance then rebuild without rejected source; code-only output; no cap increase",
      }
    : {}),
  ...(values.diversify
    ? {
        diversificationPolicy:
          "final attempt after a verified recovery rejection; cheapest eligible ready offer from a different configured provider domain; unchanged fallback",
        agentFailureDomains: Object.fromEntries([
          ["alpha", new URL(primary.baseUrl).hostname],
          ...operatorSpecs.map(
            (spec) =>
              [spec.id, new URL((spec.secondary ? secondary : primary).baseUrl).hostname] as const,
          ),
        ]),
      }
    : {}),
  auctionPolicy: "lowest eligible quote; strategy breaks price ties only",
  bidWindowMs: 1_000,
  primaryTimeAccounting:
    "cached primary waits out the same inference elapsed time before execution in the second arm",
  standbyHoldMs: 1_950,
  feedbackPolicy: values.hardened
    ? "same public preflight, contract examples and verifier summaries in both arms; rejected source omitted for rebuild; initial routing patch for every task"
    : "legacy",
  seed,
  corpusHash: digestOf(definitions),
  repeats,
  pilot: values.pilot,
  ...(values.external && {
    fixedPolicy: "ascending quoted price in each tier",
    quotes: operatorSpecs,
  }),
  expectedTrials,
  limits,
  budgetNear: { escrow: "0.40", premium: "0.04", bond: "0.25", capacity: "0.65" },
  providers: [primary, secondary].map(({ baseUrl, model }) => ({
    host: new URL(baseUrl).hostname,
    model,
  })),
  operatorControl:
    "team-controlled child processes with distinct signing keys and payout identities; primary uses the fixture key",
  outage:
    "worker-crash kills the primary process after its checkpoint; primary-provider-outage additionally prevents either primary-host specialist from bidding",
  design:
    "Paired live-inference repairs, pinned held-out acceptance and independent audit tests. HTTP coordinator, persisted events, real worker processes, fixture vault transfers. Fixed specialists and Backstop use the same roster, caps, timing and standby commitments on every pair.",
};
const save = () => {
  const rows = [...prior, ...trials];
  writeFileSync(
    values.out ?? "",
    JSON.stringify({ ...metadata, completedTrials: rows.length, trials: rows }, null, 2) + "\n",
  );
};
const prior: unknown[] = [];
const completedBlocks = new Set<string>();
const blockId = (task: string, fault: string, repeat: number) =>
  `${task}/${fault}/${String(repeat)}`;
if (values["resume-from"] !== undefined) {
  const previous = z
    .object({
      corpusHash: z.string(),
      seed: z.int(),
      expectedTrials: z.int(),
      fixedPolicy: z.literal("ascending quoted price in each tier").optional(),
      startedAt: z.iso.datetime(),
      routed: z.boolean().default(false),
      hardened: z.boolean().default(false),
      diversify: z.boolean().default(false),
      bounded: z.boolean().default(false),
      agentFailureDomains: z.record(z.string(), z.string()).optional(),
      providers: z.array(z.object({ host: z.string(), model: z.string() })),
      implementationHash: z.string().optional(),
      trials: z.array(
        z
          .object({
            task: z.string(),
            fault: z.enum(benchmarkFaults),
            repeat: z.int(),
            mode: z.enum(["market", "fixed"]),
          })
          .loose(),
      ),
    })
    .parse(JSON.parse(readFileSync(values["resume-from"], "utf8")));
  if (
    previous.corpusHash !== metadata.corpusHash ||
    previous.seed !== seed ||
    previous.expectedTrials !== expectedTrials ||
    previous.fixedPolicy !== metadata.fixedPolicy ||
    previous.routed !== metadata.routed ||
    previous.hardened !== metadata.hardened ||
    previous.diversify !== metadata.diversify ||
    previous.bounded !== metadata.bounded ||
    digestOf(previous.agentFailureDomains ?? null) !==
      digestOf(metadata.agentFailureDomains ?? null) ||
    digestOf(previous.providers) !== digestOf(metadata.providers) ||
    (values.hardened && previous.implementationHash !== metadata.implementationHash)
  )
    throw new Error("Resume requires the same corpus, seed, run size, and fixed policy");
  Object.assign(metadata, { resumedFromStartedAt: previous.startedAt, lanes: laneCount });
  const grouped = new Map<string, typeof previous.trials>();
  for (const row of previous.trials) {
    const key = blockId(row.task, row.fault, row.repeat);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  for (const [key, rows] of grouped) {
    if (rows.length !== 2 || rows[0]?.mode === rows[1]?.mode) continue;
    completedBlocks.add(key);
    prior.push(...rows);
  }
  process.stdout.write(
    `Preserved ${String(prior.length)} rows in complete pairs from the preceding run.\n`,
  );
}
const pending = blocks.filter(
  ({ task, fault, repeat }) => !completedBlocks.has(blockId(task.id, fault, repeat)),
);
save();
const lanes = await Promise.allSettled(
  Array.from({ length: Math.min(laneCount, pending.length) }, (_, index) =>
    createBenchLane(
      join(values.state ?? "", `lane-${String(index)}.sqlite`),
      primary,
      secondary,
      values.external,
      values.routed,
      values.hardened,
      values.diversify,
      values.bounded,
    ),
  ),
);
try {
  const failure = lanes.find((lane) => lane.status === "rejected");
  if (failure !== undefined) throw failure.reason;
  let cursor = 0;
  const completed = await Promise.allSettled(
    lanes.flatMap((result) =>
      result.status === "rejected"
        ? []
        : [
            (async () => {
              const lane = result.value;
              for (let block = pending[cursor++]; block !== undefined; block = pending[cursor++]) {
                let shared: Promise<Inference> | undefined;
                const getInitial = (taskId: string) => (shared ??= lane.generate(taskId));
                const modes = block.marketFirst
                  ? (["market", "fixed"] as const)
                  : (["fixed", "market"] as const);
                for (const mode of modes) {
                  const row = await lane.trial(
                    block.task,
                    block.fault,
                    block.repeat,
                    mode,
                    getInitial,
                  );
                  trials.push(row);
                  save();
                  process.stdout.write(
                    `${String(prior.length + trials.length)}/${String(expectedTrials)} ${row.taskId} ${row.correct ? "correct" : row.accepted ? "false accept" : "no delivery"}\n`,
                  );
                }
              }
            })(),
          ],
    ),
  );
  const failed = completed.find((lane) => lane.status === "rejected");
  if (failed !== undefined) throw failed.reason;
} finally {
  await Promise.allSettled(
    lanes.flatMap((lane) => (lane.status === "fulfilled" ? [lane.value.stop()] : [])),
  );
}
