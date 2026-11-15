import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Account, type Provider } from "near-api-js";
import { readFinalOutcome, type ChainSetup, type ChainStep } from "@backstop/near";
import { digestOf, repairTaskSchema } from "@backstop/shared";
import { z } from "zod";
import { writeDemoReport } from "../demo-report.js";
import { reportSchema, submissionSchema, type RepairJob } from "./schema.js";
import type { RepairJobs } from "./store.js";

const recordedStepSchema = z.object({
  label: z.string(),
  txHash: z.string().min(1),
  signer: z.string().min(1),
  outcome: z.string(),
});
export const reconciliationRecordSchema = z.object({
  network: z.literal("testnet"),
  contractId: z.string().startsWith("vault.").endsWith(".testnet"),
  teeSigners: z.array(z.object({ model: z.string().min(1) })),
  runs: z.array(
    z.object({
      taskId: z.string(),
      at: z.string(),
      kind: z.literal("live swarm"),
      steps: z.array(recordedStepSchema).min(1),
    }),
  ),
});

export function verifiedRecordedStep(
  raw: unknown,
  expected: z.infer<typeof recordedStepSchema>,
): ChainStep {
  const call = readFinalOutcome(raw);
  assert.equal(call.txHash, expected.txHash);
  assert.equal(call.signer, expected.signer);
  assert.equal(call.ok ? "success" : `refused ${call.errorCode ?? ""}`.trim(), expected.outcome);
  const allowedRefusal =
    expected.label === "A repeated settlement is refused" &&
    call.errorCode === "ERR_ALREADY_SETTLED";
  const deadlineRefusal =
    expected.label === "Coordinator finalizes the failure settlement" &&
    call.errorCode === "ERR_DEADLINE_NOT_REACHED";
  assert(
    call.ok || allowedRefusal || deadlineRefusal,
    "The run contains an unexplained failed transaction",
  );
  return { label: expected.label, call, refusalExpected: allowedRefusal || deadlineRefusal };
}

export function verifyOriginalTask(job: RepairJob, raw: unknown): void {
  const submission = submissionSchema.parse({
    requestId: job.requestId,
    repairTask: repairTaskSchema.parse(raw),
    fault: job.fault,
  });
  assert.equal(
    digestOf(submission),
    job.requestHash,
    "Original task bundle no longer matches the submitted request",
  );
}

export async function reconcileFailure(
  store: RepairJobs,
  job: RepairJob,
  provider: Provider,
): Promise<string> {
  assert.equal(job.status, "interrupted", "Only interrupted jobs need reconciliation");
  verifyOriginalTask(job, JSON.parse(readFileSync(store.path(job.id, "task.json"), "utf8")));
  const record = reconciliationRecordSchema.parse(
    JSON.parse(readFileSync(store.path(job.id, "chain.json"), "utf8")),
  );
  const runs = record.runs.filter((run) => run.taskId === job.id);
  assert.equal(runs.length, 1, "Expected one complete recorded run for this task");
  const run = runs[0];
  assert(run !== undefined);
  const chainTask = z.object({ task_id: z.string(), state: z.literal("FAILURE_SETTLED") }).parse(
    await provider.callFunction({
      contractId: record.contractId,
      method: "get_task",
      args: { task_id: job.id },
      blockQuery: { finality: "final" },
    }),
  );
  assert.equal(chainTask.task_id, job.id);
  const transactions: ChainStep[] = [];
  for (const step of run.steps) {
    const raw = await provider.viewTransactionStatus({
      txHash: step.txHash,
      accountId: step.signer,
      waitUntil: "FINAL",
    });
    transactions.push(verifiedRecordedStep(raw, step));
  }
  const duplicates = transactions.filter(
    (step) => step.label === "A repeated settlement is refused",
  );
  assert.equal(duplicates.length, 1, "Recorded duplicate-settlement refusal is required");
  const duplicate = duplicates[0]?.call;
  assert(duplicate !== undefined);
  const model = record.teeSigners.at(-1)?.model;
  assert(model !== undefined, "Recorded live model is missing");
  const root = record.contractId.slice("vault.".length);
  const account = (role: string) => new Account(`${role}.${root}`, provider);
  const chain: ChainSetup = {
    network: "testnet",
    contract: new Account(record.contractId, provider),
    deployTx: null,
    stop: () => Promise.resolve(),
    parties: {
      vault: { contractId: record.contractId },
      customer: account("customer"),
      guarantor: account("guarantor"),
      coordinator: account("coordinator"),
      verifier: account("verifier"),
      payoutAccount: (agentId) => `${agentId}.${root}`,
    },
  };
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const path = store.path(job.id, `reconciliation-${stamp}.json`);
  await writeDemoReport(path, {
    taskId: job.id,
    chain,
    transactions: transactions.filter((step) => step.call.txHash !== duplicate.txHash),
    duplicate,
    fault: job.fault,
    model,
    recordedAt: run.at,
  });
  const verified = reportSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const previousStatusPath = store.path(job.id, `interrupted-status-${stamp}.json`);
  writeFileSync(previousStatusPath, `${JSON.stringify(job, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(
    path,
    `${JSON.stringify({ ...verified, reconciliation: { checkedAt: new Date().toISOString(), mode: "read-only", previousError: job.error, previousStatusFile: `interrupted-status-${stamp}.json` } }, null, 2)}\n`,
    { mode: 0o600 },
  );
  store.finish(job, path);
  store.log(
    job,
    "Read-only reconciliation confirmed the on-chain refund and compensation; the original interruption record was preserved.",
  );
  return path;
}
