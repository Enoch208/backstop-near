import { chainMirror, type ChainMirror, type ChainParties, type ChainStep } from "@backstop/near";
import type { TaskEvent } from "@backstop/orchestrator";
import { execute, type Runtime } from "./runtime.js";

export type ChainLogEntry = {
  readonly taskId: string;
  readonly step: ChainStep;
  readonly diverged: boolean;
};

export type ChainBridge = {
  readonly network: string;
  readonly parties: ChainParties;
  readonly mirror: ChainMirror;
  readonly log: ChainLogEntry[];
  readonly queues: Map<string, Promise<void>>;
  readonly onStep: (entry: ChainLogEntry) => void;
};

export function chainBridge(
  network: string,
  parties: ChainParties,
  onStep: (entry: ChainLogEntry) => void,
): ChainBridge {
  return {
    network,
    parties,
    mirror: chainMirror(parties, { fundingFromEvents: false, repeatSettlement: false }),
    log: [],
    queues: new Map(),
    onStep,
  };
}

function indexTransfers(runtime: Runtime, taskId: string, step: ChainStep): void {
  for (const event of step.call.events) {
    const transferId = event.data.transfer_id;
    if (typeof transferId !== "string") continue;
    if (event.event === "transfer_confirmed" || event.event === "transfer_failed") {
      execute(runtime, taskId, "near-indexer", {
        kind: "resolveTransfer",
        transferId,
        succeeded: event.event === "transfer_confirmed",
      });
    }
  }
}

export function record(
  bridge: ChainBridge,
  taskId: string,
  step: ChainStep,
  gate = false,
): ChainLogEntry {
  const entry = { taskId, step, diverged: !gate && step.call.ok === step.refusalExpected };
  bridge.log.push(entry);
  bridge.onStep(entry);
  return entry;
}

export function mirrorEvents(
  runtime: Runtime,
  bridge: ChainBridge,
  events: readonly TaskEvent[],
): void {
  for (const event of events) {
    const previous = bridge.queues.get(event.taskId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const current = runtime.store.records[event.taskId];
      if (current === undefined) return;
      for (const step of await bridge.mirror.apply(current, event.body)) {
        record(bridge, event.taskId, step);
        indexTransfers(runtime, event.taskId, step);
      }
    });
    bridge.queues.set(
      event.taskId,
      next.catch((error: unknown) => {
        process.stderr.write(
          `chain mirror failed for ${event.taskId}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }),
    );
  }
}
