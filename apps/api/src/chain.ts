import { AsyncLocalStorage } from "node:async_hooks";
import {
  chainMirror,
  getTransfer,
  preparedCallSchema,
  readFinalOutcome,
  reissue,
  sendJournaled,
  type ChainCall,
  type ChainMirror,
  type ChainParties,
  type ChainStep,
} from "@backstop/near";
import type { TaskEvent, TaskRecord } from "@backstop/orchestrator";
import { z } from "zod";
import type { Persistence } from "./persistence.js";
import { atomic, execute, type Runtime } from "./runtime.js";

export type ChainLogEntry = {
  readonly taskId: string;
  readonly step: ChainStep;
  readonly diverged: boolean;
};

export type ChainBridge = {
  readonly network: string;
  readonly parties: ChainParties;
  readonly mirror: ChainMirror;
  readonly operation: AsyncLocalStorage<{ persistence: Persistence; key: string }>;
  readonly log: ChainLogEntry[];
  readonly queues: Map<string, Promise<void>>;
  readonly cursor: Map<string, number>;
  stopping: boolean;
  readonly blocked: Set<string>;
  readonly retryAfter: Map<string, number>;
  readonly onStep: (entry: ChainLogEntry) => void;
};

export function chainBridge(
  network: string,
  parties: ChainParties,
  onStep: (entry: ChainLogEntry) => void,
): ChainBridge {
  const operation = new AsyncLocalStorage<{ persistence: Persistence; key: string }>();
  let tail: Promise<ChainCall | undefined> = Promise.resolve(undefined);
  const durableParties: ChainParties = {
    ...parties,
    vault: {
      ...parties.vault,
      send: (signer, actions) => {
        const scope = operation.getStore();
        const receiverId = parties.vault.contractId;
        const send = tail.then(async () => {
          if (scope === undefined) {
            const result = await signer.signAndSendTransaction({
              receiverId,
              actions,
              waitUntil: "FINAL",
              throwOnFailure: false,
            });
            return readFinalOutcome(result);
          }
          const key = `near-tx:${scope.key}`;
          const saved = scope.persistence.get(key, preparedCallSchema);
          return sendJournaled(signer, receiverId, actions, saved, (prepared) =>
            scope.persistence.set(key, prepared),
          );
        });
        tail = send.catch(() => undefined);
        return send;
      },
    },
  };
  return {
    network,
    parties: durableParties,
    mirror: chainMirror(durableParties, { fundingFromEvents: false, repeatSettlement: false }),
    operation,
    log: [],
    queues: new Map(),
    cursor: new Map(),
    retryAfter: new Map(),
    blocked: new Set(),
    stopping: false,
    onStep,
  };
}

export function chainOperation<T>(
  runtime: Runtime,
  bridge: ChainBridge,
  key: string,
  perform: () => Promise<T>,
): Promise<T> {
  const persistence = runtime.persistence;
  return persistence === null ? perform() : bridge.operation.run({ persistence, key }, perform);
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

async function reconcileTransfers(
  runtime: Runtime,
  bridge: ChainBridge,
  current: TaskRecord,
): Promise<void> {
  const parties = bridge.parties;
  const bid = current.assignment?.bid;
  const chainBid = bid === undefined ? undefined : reissue(bid, parties.payoutAccount).bid;
  const pending = current.ledger.transfers.filter((transfer) => transfer.status === "PENDING");
  const views = await Promise.all(
    pending.map(async (transfer) => ({
      transfer,
      view: await getTransfer(bridge.parties.vault, bridge.parties.coordinator, transfer.id),
    })),
  );
  for (const { transfer, view } of views) {
    if (view === null || view.retries < transfer.retries || view.status === "PENDING") continue;
    const recipient =
      transfer.purpose === "payout"
        ? current.assignment?.bid.bid.members.find(
            (member) => member.account === transfer.recipient,
          )
        : undefined;
    const expected =
      recipient === undefined
        ? transfer.purpose === "bond_release" || transfer.purpose === "premium_earned"
          ? parties.guarantor.accountId
          : parties.customer.accountId
        : chainBid?.members.find((member) => member.agentId === recipient.agentId)?.account;
    if (
      view.id !== transfer.id ||
      view.task_id !== current.taskId ||
      view.amount !== transfer.amount.toString() ||
      view.pool !== transfer.pool.toUpperCase() ||
      view.recipient !== expected ||
      view.retries !== transfer.retries
    ) {
      throw new Error(`Final NEAR transfer ${transfer.id} diverges from the local settlement plan`);
    }
    execute(runtime, current.taskId, "near-indexer", {
      kind: "resolveTransfer",
      transferId: transfer.id,
      succeeded: view.status === "CONFIRMED",
    });
  }
}

async function drain(runtime: Runtime, bridge: ChainBridge, taskId: string): Promise<void> {
  const current = runtime.store.records[taskId];
  const stream = runtime.store.streams[taskId];
  if (current === undefined || stream === undefined) return;
  const key = `chain-cursor:${taskId}`;
  let cursor = bridge.cursor.get(taskId);
  if (cursor === undefined) {
    cursor = runtime.persistence?.get(key, z.int().nonnegative()) ?? 0;
    for (const event of stream.slice(0, cursor))
      if (event.body.type === "verification_recorded")
        await bridge.mirror.apply(current, event.body);
  }
  for (const event of stream.slice(cursor)) {
    const steps = await chainOperation(runtime, bridge, event.eventId, () =>
      bridge.mirror.apply(current, event.body),
    );
    for (const step of steps) record(bridge, taskId, step);
    const refused = steps.find((step) => step.call.ok === step.refusalExpected);
    if (refused !== undefined) {
      if (
        event.body.type === "settlement_started" &&
        event.body.kind === "failure" &&
        refused.call.errorCode === "ERR_DEADLINE_NOT_REACHED"
      ) {
        runtime.persistence?.del(`near-tx:${event.eventId}`);
        bridge.retryAfter.set(taskId, Math.max(current.manifest.deadlineMs, runtime.now()) + 2_000);
        return;
      }
      if (
        event.body.type !== "settlement_started" ||
        refused.call.errorCode !== "ERR_ALREADY_SETTLED"
      ) {
        bridge.blocked.add(taskId);
        throw new Error(
          `${refused.label} refused: ${refused.call.errorCode ?? "unexpected result"}`,
        );
      }
    }
    atomic(runtime, () => {
      runtime.persistence?.set(key, event.version);
      runtime.persistence?.del(`near-tx:${event.eventId}`);
    });
    bridge.cursor.set(taskId, event.version);
  }
  await reconcileTransfers(runtime, bridge, current);
}

export function mirrorEvents(
  runtime: Runtime,
  bridge: ChainBridge,
  events: readonly TaskEvent[],
): void {
  for (const taskId of new Set(events.map((event) => event.taskId)))
    mirrorTask(runtime, bridge, taskId);
}

export function mirrorTask(runtime: Runtime, bridge: ChainBridge, taskId: string): void {
  if (
    bridge.stopping ||
    bridge.queues.has(taskId) ||
    bridge.blocked.has(taskId) ||
    runtime.now() < (bridge.retryAfter.get(taskId) ?? 0)
  )
    return;
  const current = runtime.store.records[taskId];
  if (
    current === undefined ||
    (current.version === bridge.cursor.get(taskId) &&
      !current.ledger.transfers.some((transfer) => transfer.status === "PENDING"))
  )
    return;
  bridge.retryAfter.delete(taskId);
  const work = drain(runtime, bridge, taskId)
    .catch((error: unknown) => {
      bridge.retryAfter.set(taskId, runtime.now() + 2_000);
      process.stderr.write(
        `chain mirror failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    })
    .finally(() => {
      bridge.queues.delete(taskId);
      const next = runtime.store.records[taskId];
      if (next !== undefined && next.version !== bridge.cursor.get(taskId))
        mirrorTask(runtime, bridge, taskId);
    });
  bridge.queues.set(taskId, work);
}
