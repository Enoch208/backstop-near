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
  const checksCapacity =
    request.command.kind === "reserveStandby" ||
    request.command.kind === "closeAuction" ||
    request.command.kind === "assignPrimary";
  const decision = decide(
    record,
    request.command,
    checksCapacity
      ? { ...context, busyAgents: busyAgents(store, request.taskId, context.nowMs) }
      : context,
  );
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

function busyAgents(store: Store, taskId: string, nowMs: number): ReadonlySet<string> {
  const busy = new Set<string>();
  for (const record of Object.values(store.records)) {
    if (record.taskId === taskId || record.manifest.deadlineMs < nowMs) continue;
    const assigned = ["ASSIGNED", "RECOVERY_ASSIGNED", "EXECUTING"].includes(record.state);
    if (assigned)
      for (const member of record.assignment?.bid.bid.members ?? []) busy.add(member.agentId);
    if (
      [
        "ACCEPTED",
        "SETTLEMENT_PENDING",
        "SETTLED",
        "TERMINAL_FAILURE",
        "FAILURE_SETTLEMENT_PENDING",
        "FAILURE_SETTLED",
      ].includes(record.state)
    )
      continue;
    const open = record.state === "RECOVERY_OPEN";
    for (const { bid } of record.standby) {
      if (bid.epoch <= (open ? record.epoch - 1 : record.epoch) || bid.expiresAtMs < nowMs)
        continue;
      for (const { agentId } of bid.members)
        if (!record.excludedAgents.includes(agentId)) busy.add(agentId);
    }
  }
  return busy;
}
