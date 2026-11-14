import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { modelFromEnv } from "@backstop/agents";
import { digestOf, seededRandom } from "@backstop/shared";
import { blindTasks } from "./benchmark/blind-tasks.js";
import { prepare } from "./benchmark/evaluate.js";
import { loadExternalTasks } from "./benchmark/external-tasks.js";
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
    "resume-from": { type: "string" },
  },
});
if (values.verify !== undefined) {
  const result = verifyStandbyRun(
    values.verify,
    values.external ? await loadExternalTasks() : blindTasks,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}
const laneCount = Number(values.lanes);
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

const definitions = values.external ? await loadExternalTasks() : blindTasks;
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
      trials: z.array(
        z
          .object({
            task: z.string(),
            fault: z.enum(benchmarkFaults),
            repeat: z.int(),
            mode: z.enum(["market", "fixed"]),
          })
          .passthrough(),
      ),
    })
    .parse(JSON.parse(readFileSync(values["resume-from"], "utf8")));
  if (
    previous.corpusHash !== metadata.corpusHash ||
    previous.seed !== seed ||
    previous.expectedTrials !== expectedTrials ||
    previous.fixedPolicy !== metadata.fixedPolicy
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
