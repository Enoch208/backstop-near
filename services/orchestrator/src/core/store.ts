import { fail, succeed, type Outcome } from "@backstop/shared";
import type { Command, DecisionContext } from "./commands.js";
import { decide } from "./decide.js";
import type { TaskEvent } from "./events.js";
import { evolve } from "./evolve.js";
import type { TaskRecord } from "./record.js";

export type Store = {
  readonly streams: Readonly<Record<string, readonly TaskEvent[]>>;
  readonly records: Readonly<Record<string, TaskRecord>>;
};

export type Dispatch = {
  readonly taskId: string;
  readonly actor: string;
  readonly command: Command;
  readonly expectedVersion?: number;
};

export const emptyStore: Store = { streams: {}, records: {} };

export function replay(events: readonly TaskEvent[]): TaskRecord | null {
  const seen = new Set<string>();
  const unique = events.filter((event) => !seen.has(event.eventId) && seen.add(event.eventId));
  return [...unique]
    .sort((a, b) => a.version - b.version)
    .reduce<TaskRecord | null>((record, event) => evolve(record, event), null);
}

export function dispatch(
  store: Store,
  request: Dispatch,
  context: DecisionContext,
): Outcome<{ store: Store; events: TaskEvent[] }> {
  const record = store.records[request.taskId] ?? null;
  const version = record?.version ?? 0;
  if (request.expectedVersion !== undefined && request.expectedVersion !== version) {
    return fail(
      "STALE_STATE",
      `Task is at version ${String(version)}, not ${String(request.expectedVersion)}`,
    );
  }
  const decision = decide(record, request.command, context);
  if (!decision.ok) return decision;
  const events = decision.value.map((body, index) => ({
    eventId: `${request.taskId}#${String(version + index + 1)}`,
    taskId: request.taskId,
    version: version + index + 1,
    atMs: context.nowMs,
    actor: request.actor,
    body,
  }));
  const next = events.reduce<TaskRecord | null>((current, event) => evolve(current, event), record);
  if (next === null) return succeed({ store, events });
  return succeed({
    store: {
      streams: {
        ...store.streams,
        [request.taskId]: [...(store.streams[request.taskId] ?? []), ...events],
      },
      records: { ...store.records, [request.taskId]: next },
    },
    events,
  });
}
