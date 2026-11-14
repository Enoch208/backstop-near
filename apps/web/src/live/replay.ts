import { useEffect, useMemo, useState } from "react";
import { asset } from "../data/base.js";
import { z } from "zod";
import {
  chainSchema,
  eventSchema,
  snapshotSchema,
  workersSchema,
  type ChainSteps,
  type FeedEvent,
  type Snapshot,
  type Worker,
} from "./api.js";

const frameSchema = z.object({
  atMs: z.number(),
  event: z.unknown(),
  task: z.unknown(),
  workers: z.unknown(),
  chain: z.unknown(),
});

const runSchema = z.object({
  taskId: z.string(),
  network: z.string(),
  model: z.string().nullable(),
  recordedAt: z.string(),
  frames: z.array(frameSchema).min(1),
});
export type RecordedRun = z.infer<typeof runSchema>;

export const runIndexSchema = z.array(
  z.object({ taskId: z.string(), network: z.string(), recordedAt: z.string() }),
);

export type ReplayState = {
  readonly run: RecordedRun | null;
  readonly error: string | null;
  readonly events: readonly FeedEvent[];
  readonly snapshot: Snapshot | null;
  readonly workers: readonly Worker[];
  readonly chain: ChainSteps | null;
  readonly done: boolean;
};

function lastParsed<T>(
  frames: readonly z.infer<typeof frameSchema>[],
  pick: (frame: z.infer<typeof frameSchema>) => unknown,
  schema: z.ZodType<T>,
): T | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame === undefined) continue;
    const value = pick(frame);
    if (value === null || value === undefined) continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return null;
}

export function useReplay(runId: string, speed: number, startedAt: number): ReplayState {
  const [run, setRun] = useState<RecordedRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    fetch(asset(`runs/${encodeURIComponent(runId)}.json`))
      .then(async (response) => {
        if (!response.ok) throw new Error(`No recorded run ${runId}`);
        const parsed = runSchema.parse(await response.json());
        if (live) setRun(parsed);
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : "unreadable run");
      });
    return () => {
      live = false;
    };
  }, [runId]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return useMemo(() => {
    if (run === null)
      return { run, error, events: [], snapshot: null, workers: [], chain: null, done: false };
    const elapsed = (now - startedAt) * speed + (run.frames[0]?.atMs ?? 0);
    const shown = run.frames.filter((frame) => frame.atMs <= elapsed);
    const events = shown.flatMap((frame) => {
      const parsed = eventSchema.safeParse(frame.event);
      return parsed.success ? [parsed.data] : [];
    });
    const workers = lastParsed(shown, (frame) => frame.workers, workersSchema);
    return {
      run,
      error,
      events,
      snapshot: lastParsed(shown, (frame) => frame.task, snapshotSchema),
      workers: (workers?.workers ?? []).filter((worker) => worker.taskId === run.taskId),
      chain: lastParsed(shown, (frame) => frame.chain, chainSchema),
      done: shown.length === run.frames.length,
    };
  }, [run, error, now, speed, startedAt]);
}
