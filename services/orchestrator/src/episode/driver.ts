import type { Failure } from "@backstop/shared";
import type { Command, Registry } from "../core/commands.js";
import type { TaskEvent } from "../core/events.js";
import type { TaskRecord } from "../core/record.js";
import { dispatch, emptyStore, type Store } from "../core/store.js";

export type Step = {
  readonly atMs: number;
  readonly actor: string;
  readonly command: Command["kind"];
  readonly note: string;
  readonly events: readonly TaskEvent[];
  readonly refused: Failure | null;
};

export type Driver = {
  readonly taskId: string;
  readonly registry: Registry;
  store: Store;
  nowMs: number;
  readonly steps: Step[];
};

export function newDriver(taskId: string, registry: Registry, startMs: number): Driver {
  return { taskId, registry, store: emptyStore, nowMs: startMs, steps: [] };
}

export function record(driver: Driver): TaskRecord {
  const current = driver.store.records[driver.taskId];
  if (current === undefined) throw new Error(`Task ${driver.taskId} has not been created`);
  return current;
}

export function advance(driver: Driver, ms: number): void {
  driver.nowMs += ms;
}

export function attempt(driver: Driver, actor: string, command: Command, note: string): Step {
  const outcome = dispatch(
    driver.store,
    { taskId: driver.taskId, actor, command },
    { nowMs: driver.nowMs, registry: driver.registry },
  );
  const step: Step = {
    atMs: driver.nowMs,
    actor,
    command: command.kind,
    note,
    events: outcome.ok ? outcome.value.events : [],
    refused: outcome.ok ? null : outcome.failure,
  };
  if (outcome.ok) driver.store = outcome.value.store;
  driver.steps.push(step);
  return step;
}

export function run(driver: Driver, actor: string, command: Command, note: string): Step {
  const step = attempt(driver, actor, command, note);
  if (step.refused !== null) {
    throw new Error(`${command.kind} refused: ${step.refused.code} ${step.refused.message}`);
  }
  return step;
}
