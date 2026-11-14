import { useEffect, useState } from "react";
import { z } from "zod";

const tasksSchema = z.object({
  tasks: z.array(z.object({ taskId: z.string(), state: z.string(), version: z.number() })),
});

const inferenceSchema = z.object({
  model: z.string(),
  signingAddress: z.string(),
  chatId: z.string(),
  responseHash: z.string(),
});

const evidenceSchema = z.object({
  body: z.object({
    attempt: z.number(),
    verdict: z.string(),
    totals: z.object({ passed: z.number(), failed: z.number() }),
    artifactHash: z.string(),
    inference: inferenceSchema.optional(),
  }),
  evidenceHash: z.string(),
});

export const snapshotSchema = z.object({
  task: z.object({
    taskId: z.string(),
    state: z.string(),
    version: z.number(),
    attempt: z.number(),
    excludedAgents: z.array(z.string()),
    candidate: z.object({ attempt: z.number(), evidence: evidenceSchema.nullable() }).nullable(),
  }),
  statement: z.object({
    totalIn: z.string(),
    held: z.string(),
    byStatus: z.object({ PENDING: z.string(), FAILED: z.string(), CONFIRMED: z.string() }),
    confirmedByRecipient: z.record(z.string(), z.string()),
  }),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const workersSchema = z.object({
  workers: z.array(
    z.object({
      taskId: z.string(),
      agentId: z.string(),
      pid: z.number().nullable(),
      exit: z.object({ code: z.number().nullable(), signal: z.string().nullable() }).nullable(),
    }),
  ),
});
export type Worker = z.infer<typeof workersSchema>["workers"][number];

export const chainSchema = z.object({
  network: z.string().nullable(),
  steps: z.array(
    z.object({
      label: z.string(),
      txHash: z.string(),
      ok: z.boolean(),
      errorCode: z.string().nullable(),
    }),
  ),
});
export type ChainSteps = z.infer<typeof chainSchema>;

export const eventSchema = z.object({
  version: z.number(),
  actor: z.string(),
  body: z.looseObject({ type: z.string() }),
});
export type FeedEvent = z.infer<typeof eventSchema>;

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} answered HTTP ${String(response.status)}`);
  return schema.parse(await response.json());
}

export function usePolled<T>(path: string | null, schema: z.ZodType<T>, everyMs = 1000) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    const load = () => {
      getJson(path, schema)
        .then((next) => {
          if (!live) return;
          setValue(next);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (live) setError(reason instanceof Error ? reason.message : "unreachable");
        });
    };
    load();
    const timer = setInterval(load, everyMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path, schema, everyMs]);
  return { value, error };
}

export function useLatestTask(preferred: string | null) {
  const tasks = usePolled("/api/tasks", tasksSchema, 1500);
  const ids = tasks.value?.tasks.map((task) => task.taskId) ?? [];
  const taskId = preferred !== null && ids.includes(preferred) ? preferred : (ids.at(-1) ?? null);
  return { taskId, error: tasks.error, reachable: tasks.value !== null };
}

export function useEvents(taskId: string | null) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    if (taskId === null) return;
    const source = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/events`);
    source.addEventListener("task", (message) => {
      const parsed = eventSchema.safeParse(JSON.parse(String(message.data)));
      if (!parsed.success) return;
      setEvents((previous) =>
        previous.some((event) => event.version === parsed.data.version)
          ? previous
          : [...previous, parsed.data],
      );
    });
    return () => {
      source.close();
    };
  }, [taskId]);
  return events;
}
