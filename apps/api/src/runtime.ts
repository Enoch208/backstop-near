import { identities, roster } from "@backstop/agents";
import type { AttestedInference, Digest, Finding, Outcome, RepairTask } from "@backstop/shared";
import { react } from "./automations.js";
import type { ChainBridge } from "./chain.js";
import { openPersistence, type Persistence, type replySchema } from "./persistence.js";
import type { z } from "zod";
import type { IntentsConfig, PayoutQuote } from "./payouts.js";
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

export type AgentLine = {
  readonly atMs: number;
  readonly agentId: string;
  readonly line: string;
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
  readonly findings: Map<Digest, Finding>;
  readonly teeSigners: Map<string, string>;
  readonly agentLog: Map<string, AgentLine[]>;
  readonly inferences: Map<Digest, AttestedInference>;
  readonly repairTasks: Map<Digest, RepairTask>;
  readonly persistence: Persistence | null;
  deferredEvents: TaskEvent[] | null;
  readonly pendingFunding: Set<string>;
  readonly replies: Map<string, Reply>;
  readonly inflight: Map<string, { fingerprint: Digest; promise: Promise<Reply> }>;
  readonly listeners: Set<(event: TaskEvent) => void>;
  readonly faults: { failNextTransfer: boolean };
  store: Store;
  workers: WorkerControl | null;
  chain: ChainBridge | null;
  intents: IntentsConfig | null;
  readonly payouts: Map<string, readonly PayoutQuote[]>;
};

export type Reply = z.infer<typeof replySchema>;

export function createRuntime(
  now: () => number,
  demo: boolean,
  statePath?: string,
  agentFailureDomains?: Readonly<Record<string, string>>,
): Runtime {
  const agentKeys = Object.fromEntries(
    identities.map((identity) => [identity.id, identity.key.publicKey]),
  );
  const runtime: Runtime = {
    mode: "fixture",
    demo,
    now,
    registry: {
      agentKeys,
      verifierPublicKey: roster.verifier.key.publicKey,
      ...(agentFailureDomains === undefined
        ? {}
        : { agentFailureDomains: { ...agentFailureDomains } }),
    },
    identities: new Map(
      identities.map((identity) => [
        identity.id,
        { id: identity.id, account: identity.account, publicKey: identity.key.publicKey },
      ]),
    ),
    artifacts: new Map(),
    findings: new Map(),
    teeSigners: new Map(),
    agentLog: new Map(),
    inferences: new Map(),
    repairTasks: new Map(),
    persistence: statePath === undefined ? null : openPersistence(statePath),
    deferredEvents: null,
    pendingFunding: new Set(),
    replies: new Map(),
    inflight: new Map(),
    listeners: new Set(),
    faults: { failNextTransfer: false },
    store: emptyStore,
    workers: null,
    chain: null,
    intents: null,
    payouts: new Map(),
  };
  runtime.persistence?.restore(runtime);
  return runtime;
}

function publish(runtime: Runtime, events: readonly TaskEvent[]): void {
  for (const event of events) {
    for (const listener of runtime.listeners) listener(event);
  }
  react(runtime, events);
}

export function atomic<T>(runtime: Runtime, run: () => T): T {
  const persistence = runtime.persistence;
  if (runtime.deferredEvents !== null) return run();
  const events: TaskEvent[] = [];
  persistence?.db.exec("BEGIN IMMEDIATE");
  runtime.deferredEvents = events;
  let result: T;
  try {
    result = run();
    persistence?.flush(runtime, events);
    persistence?.db.exec("COMMIT");
  } catch (error) {
    persistence?.db.exec("ROLLBACK");
    persistence?.restore(runtime);
    throw error;
  } finally {
    runtime.deferredEvents = null;
  }
  if (events.length > 0) publish(runtime, events);
  return result;
}

export function execute(
  runtime: Runtime,
  taskId: string,
  actor: string,
  command: Command,
): Outcome<TaskEvent[]> {
  return atomic(runtime, () => {
    const outcome = dispatch(
      runtime.store,
      { taskId, actor, command },
      { nowMs: runtime.now(), registry: runtime.registry },
    );
    if (!outcome.ok) return outcome;
    runtime.store = outcome.value.store;
    runtime.deferredEvents?.push(...outcome.value.events);
    return { ok: true, value: outcome.value.events };
  });
}
