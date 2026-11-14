import { readFileSync } from "node:fs";
import { digestSchema, digestText } from "@backstop/shared";
import { z } from "zod";
import { check, type PreparedTask } from "./evaluate.js";
import { faults, type Fault } from "./run.js";
import { modes } from "./schedule.js";

const attemptSchema = z.object({
  result: z.string(),
  sourceHash: digestSchema.nullable(),
});

const trialSchema = z.object({
  task: z.string(),
  fault: z.enum(faults),
  mode: z.enum(modes),
  repeat: z.int().positive(),
  accepted: z.boolean(),
  correct: z.boolean(),
  attempts: z.array(attemptSchema).min(1),
  deliveredSource: z.string().nullable(),
});

const reportSchema = z.object({
  corpusHash: digestSchema,
  completedTrials: z.int().nonnegative(),
  expectedTrials: z.int().positive(),
  pilot: z.boolean(),
  repeats: z.int().positive(),
  trials: z.array(trialSchema),
});

export function verifyRun(
  path: string,
  corpora: readonly { tasks: readonly PreparedTask[]; hash: string; faults: readonly Fault[] }[],
) {
  const report = reportSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const corpus = corpora.find(({ hash }) => hash === report.corpusHash);
  if (corpus === undefined) throw new Error("The recorded corpus digest differs");
  const selected = report.pilot ? corpus.tasks.slice(0, 2) : corpus.tasks;
  const expected = selected.length * corpus.faults.length * modes.length * report.repeats;
  if (
    report.completedTrials !== expected ||
    report.expectedTrials !== expected ||
    report.trials.length !== expected
  ) {
    throw new Error("The recorded run is incomplete");
  }
  const seen = new Set<string>();
  let delivered = 0;
  for (const row of report.trials) {
    const task = selected.find(({ id }) => id === row.task);
    const name = `${row.task}/${row.fault}/${row.mode}/${String(row.repeat)}`;
    if (
      task === undefined ||
      !corpus.faults.includes(row.fault) ||
      row.repeat > report.repeats ||
      seen.has(name)
    )
      throw new Error(`Unexpected trial ${name}`);
    seen.add(name);
    if (row.deliveredSource === null) {
      if (row.accepted || row.correct) throw new Error(`Missing delivered source for ${name}`);
      continue;
    }
    if (row.attempts.at(-1)?.sourceHash !== digestText(row.deliveredSource))
      throw new Error(`Altered source for ${name}`);
    const accepts = check(row.deliveredSource, task.entry, task.acceptance).length === 0;
    const correct = check(row.deliveredSource, task.entry, task.audit).length === 0;
    if (!accepts || !row.accepted || correct !== row.correct)
      throw new Error(`Recorded outcomes differ for ${name}`);
    delivered++;
  }
  return { trials: seen.size, deliveries: delivered };
}
