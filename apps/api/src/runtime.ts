import { identities, roster } from "@backstop/agents";
import type { Digest, Outcome } from "@backstop/shared";
import { react } from "./automations.js";
import {
  dispatch,
  emptyStore,
  type Command,
  type Registry,
  type Store,
  type TaskEvent,
} from "@backstop/orchestrator";

export type WorkerControl = {
  readonly launch: (taskId: string) => void;
  readonly kill: (taskId: string, agentId: string) => boolean;
  readonly processes: () => readonly WorkerProcess[];
  readonly stop: () => void;
};

export type WorkerProcess = {
  readonly taskId: string;
  readonly agentId: string;
  readonly pid: number | null;
  readonly startedAtMs: number;
  readonly exitedAtMs: number | null;
  readonly exit: { code: number | null; signal: string | null } | null;
};

export type Identity = {
  readonly id: string;
  readonly account: string;
  readonly publicKey: string;
};

export type Runtime = {
  readonly mode: "fixture";
  readonly demo: boolean;
  readonly now: () => number;
  registry: Registry;
  readonly identities: Map<string, Identity>;
  readonly artifacts: Map<Digest, string>;
  readonly replies: Map<string, { status: number; body: string }>;
  readonly listeners: Set<(event: TaskEvent) => void>;
  readonly faults: { failNextTransfer: boolean };
  store: Store;
  workers: WorkerControl | null;
};

export function createRuntime(now: () => number, demo: boolean): Runtime {
  const agentKeys = Object.fromEntries(
    identities.map((identity) => [identity.id, identity.key.publicKey]),
  );
  return {
    mode: "fixture",
    demo,
    now,
    registry: { agentKeys, verifierPublicKey: roster.verifier.key.publicKey },
    identities: new Map(
      identities.map((identity) => [
        identity.id,
        { id: identity.id, account: identity.account, publicKey: identity.key.publicKey },
      ]),
    ),
    artifacts: new Map(),
    replies: new Map(),
    listeners: new Set(),
    faults: { failNextTransfer: false },
    store: emptyStore,
    workers: null,
  };
}

export function execute(
  runtime: Runtime,
  taskId: string,
  actor: string,
  command: Command,
): Outcome<TaskEvent[]> {
  const outcome = dispatch(
    runtime.store,
    { taskId, actor, command },
    { nowMs: runtime.now(), registry: runtime.registry },
  );
  if (!outcome.ok) return outcome;
  runtime.store = outcome.value.store;
  for (const event of outcome.value.events) {
    for (const listener of runtime.listeners) listener(event);
  }
  react(runtime, outcome.value.events);
  return { ok: true, value: outcome.value.events };
}
