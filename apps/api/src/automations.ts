import { roster } from "@backstop/agents";
import { checkoutSuite, fixtureAccounts } from "@backstop/fixture-checkout";
import { maxTransferRetries } from "@backstop/ledger";
import { dueCommands, type TaskEvent, type TaskRecord } from "@backstop/orchestrator";
import { verifyArtifact } from "@backstop/verifier";
import { mirrorEvents } from "./chain.js";
import { execute, type Runtime } from "./runtime.js";

function verifySubmission(runtime: Runtime, record: TaskRecord): void {
  const candidate = record.candidate;
  if (candidate === null || candidate.evidence !== null) return;
  const source = runtime.artifacts.get(candidate.artifactHash);
  if (source === undefined) return;
  const evidence = verifyArtifact({
    taskId: record.taskId,
    attempt: candidate.attempt,
    fencingToken: candidate.fencingToken,
    policyHash: record.manifestHash,
    artifactHash: candidate.artifactHash,
    artifactSource: source,
    suite: checkoutSuite,
    suiteHash: record.manifest.suite.suiteHash,
    runnerId: record.manifest.suite.runnerId,
    verifierAccount: fixtureAccounts.verifier,
    signer: roster.verifier.key,
  });
  execute(runtime, record.taskId, "verifier", { kind: "recordVerification", evidence });
}

function settleTransfers(runtime: Runtime, record: TaskRecord): void {
  for (const transfer of record.ledger.transfers) {
    if (transfer.status !== "PENDING") continue;
    const succeeded = !runtime.faults.failNextTransfer;
    runtime.faults.failNextTransfer = false;
    execute(runtime, record.taskId, "fixture-vault", {
      kind: "resolveTransfer",
      transferId: transfer.id,
      succeeded,
    });
  }
}

export function react(runtime: Runtime, events: readonly TaskEvent[]): void {
  if (runtime.chain !== null) mirrorEvents(runtime, runtime.chain, events);
  for (const event of events) {
    const record = runtime.store.records[event.taskId];
    if (record === undefined) continue;
    if (event.body.type === "task_created") runtime.workers?.launch(event.taskId);
    if (event.body.type === "artifact_submitted") verifySubmission(runtime, record);
    const settling =
      event.body.type === "settlement_started" || event.body.type === "transfer_retried";
    if (settling && runtime.chain === null) settleTransfers(runtime, record);
  }
}

export function tick(runtime: Runtime): void {
  for (const record of Object.values(runtime.store.records)) {
    for (const command of dueCommands(record, runtime.now())) {
      execute(runtime, record.taskId, "keeper", command);
    }
    const current = runtime.store.records[record.taskId] ?? record;
    for (const transfer of current.ledger.transfers) {
      if (transfer.status === "FAILED" && transfer.retries < maxTransferRetries) {
        execute(runtime, record.taskId, "keeper", {
          kind: "retryTransfer",
          transferId: transfer.id,
        });
      }
    }
  }
}
