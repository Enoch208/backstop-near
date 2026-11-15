import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { roster } from "@backstop/agents";
import {
  getLedger,
  getTransfer,
  publishedCodeHash,
  readFinalOutcome,
  type ChainCall,
  type ChainSetup,
  type ChainStep,
} from "@backstop/near";
import {
  digestOf,
  digestSchema,
  digestText,
  evidenceBundleSchema,
  evidenceHash,
  taskManifestSchema,
  verifyValue,
  type Digest,
} from "@backstop/shared";
import type { ApiClient } from "@backstop/workers";
import { z } from "zod";
import { checkCompensation } from "./compensation-proof.js";

export type DemoReportInput = {
  readonly taskId: string;
  readonly client?: ApiClient;
  readonly chain: ChainSetup;
  readonly transactions: readonly ChainStep[];
  readonly duplicate: ChainCall;
  readonly fault: "none" | "primary-after-checkpoint" | "recovery-unavailable";
  readonly model: string;
  readonly artifactHash?: Digest;
  readonly recordedAt: string;
};

const chainTaskSchema = z.object({
  task_id: z.string(),
  state: z.enum(["SETTLED", "FAILURE_SETTLED"]),
  manifest_hash: z.string(),
  owner: z.string(),
  transfer_ids: z.array(z.string()),
  verdict: z
    .object({
      attempt: z.int(),
      outcome: z.enum(["ACCEPT", "REJECT"]),
      artifact_hash: z.string(),
      suite_hash: z.string(),
      evidence_hash: z.string(),
    })
    .nullable(),
});
const acceptedTaskSchema = z.object({
  task: z.object({
    taskId: z.string(),
    state: z.literal("SETTLED"),
    manifest: taskManifestSchema,
    manifestHash: digestSchema,
    attempt: z.int(),
    fencingToken: z.int(),
    candidate: z.object({
      artifactHash: digestSchema,
      evidence: evidenceBundleSchema,
    }),
  }),
});

export function checkAcceptedReport(
  raw: unknown,
  chainRaw: unknown,
  artifactHash: Digest,
  model: string,
) {
  const { task } = acceptedTaskSchema.parse(raw);
  const chainTask = chainTaskSchema.parse(chainRaw);
  const evidence = task.candidate.evidence;
  const body = evidence.body;
  assert.equal(chainTask.task_id, task.taskId);
  assert.equal(chainTask.state, "SETTLED");
  assert.equal(task.manifestHash, digestOf(task.manifest));
  assert.equal(task.manifestHash, `sha256:${chainTask.manifest_hash}`);
  assert.equal(body.taskId, task.taskId);
  assert.equal(body.attempt, task.attempt);
  assert.equal(body.fencingToken, task.fencingToken);
  assert.equal(body.policyHash, task.manifestHash);
  assert.equal(body.suiteHash, task.manifest.suite.suiteHash);
  assert.equal(body.verdict, "ACCEPT");
  assert.equal(body.artifactHash, artifactHash);
  assert.equal(task.candidate.artifactHash, artifactHash);
  assert.equal(evidence.evidenceHash, evidenceHash(body));
  assert.equal(evidence.signature.publicKey, roster.verifier.key.publicKey);
  assert(verifyValue({ evidenceHash: evidence.evidenceHash }, evidence.signature));
  assert.equal(body.totals.failed, 0);
  assert.equal(body.totals.passed, body.checks.length);
  assert(body.checks.every(({ status }) => status === "pass"));
  assert.equal(body.inference?.model, model, "Accepted work lacks this live model's receipt");
  assert.equal(chainTask.verdict?.outcome, "ACCEPT");
  assert.equal(chainTask.verdict.attempt, body.attempt);
  assert.equal(`sha256:${chainTask.verdict.artifact_hash}`, artifactHash);
  assert.equal(`sha256:${chainTask.verdict.suite_hash}`, body.suiteHash);
  assert.equal(`sha256:${chainTask.verdict.evidence_hash}`, evidence.evidenceHash);
  return {
    evidenceHash: evidence.evidenceHash,
    suiteHash: body.suiteHash,
    checks: { passed: body.totals.passed, total: body.checks.length },
  };
}

export async function writeDemoReport(path: string, input: DemoReportInput): Promise<void> {
  const { chain, client, taskId, duplicate } = input;
  assert.equal(chain.network, "testnet");
  assert.equal(chain.parties.vault.token, undefined, "This report currently verifies native NEAR");
  assert(input.model.length > 0);
  const vault = chain.parties.vault;
  const reader = chain.parties.coordinator;
  const state = await chain.contract.getState();
  assert.equal(state.codeHash, publishedCodeHash());
  const raw = await reader.provider.callFunction({
    contractId: vault.contractId,
    method: "get_task",
    args: { task_id: taskId },
    blockQuery: { finality: "final" },
  });
  const task = chainTaskSchema.parse(raw);
  assert.equal(task.task_id, taskId);
  const ledger = await getLedger(vault, reader, taskId);
  assert(ledger !== null);
  assert.equal(ledger.state, task.state);
  assert.equal(ledger.total_inflow, ledger.confirmed_outflow);
  for (const value of [
    ledger.pending_outflow,
    ledger.failed_outflow,
    ledger.escrow_available,
    ledger.premium_available,
    ledger.bond_available,
  ])
    assert.equal(value, "0");
  const transfers = [];
  for (const id of task.transfer_ids) {
    const transfer = await getTransfer(vault, reader, id);
    assert(transfer !== null);
    assert.equal(transfer.id, id);
    assert.equal(transfer.task_id, taskId);
    assert.equal(transfer.status, "CONFIRMED");
    transfers.push(transfer);
  }
  assert.equal(new Set(task.transfer_ids).size, task.transfer_ids.length);
  assert.equal(
    transfers.reduce((sum, item) => sum + BigInt(item.amount), 0n).toString(),
    ledger.confirmed_outflow,
  );
  let compensation = "0";
  let customerRefund = transfers
    .filter(({ recipient }) => recipient === task.owner)
    .reduce((sum, item) => sum + BigInt(item.amount), 0n)
    .toString();
  let acceptance: ReturnType<typeof checkAcceptedReport> | undefined;
  if (task.state === "FAILURE_SETTLED") {
    const proof = checkCompensation(raw, ledger, transfers);
    compensation = proof.compensationYocto;
    customerRefund = proof.customerRefundYocto;
    assert.equal(input.artifactHash, undefined);
  } else {
    assert(client !== undefined, "An accepted report requires its original verifier evidence");
    assert(input.artifactHash !== undefined);
    const response = await client.get(`/api/tasks/${taskId}`);
    assert.equal(response.status, 200);
    acceptance = checkAcceptedReport(response.body, raw, input.artifactHash, input.model);
    const artifact = await client.get(`/api/tasks/${taskId}/artifacts/${input.artifactHash}`);
    assert.equal(artifact.status, 200);
    assert.equal(
      digestText(z.object({ source: z.string() }).parse(artifact.body).source),
      input.artifactHash,
    );
  }
  const transactions = input.transactions.map(({ label, call, refusalExpected }) => {
    const deadlineWait =
      task.state === "FAILURE_SETTLED" &&
      label === "Coordinator finalizes the failure settlement" &&
      !call.ok &&
      call.errorCode === "ERR_DEADLINE_NOT_REACHED";
    assert.equal(call.ok, !(refusalExpected || deadlineWait), label);
    return {
      txHash: call.txHash,
      label: deadlineWait ? `${label} — before deadline; later retried` : label,
      ok: call.ok,
      refusalExpected: refusalExpected || deadlineWait,
      errorCode: call.errorCode,
    };
  });
  const duplicateRaw = await reader.provider.viewTransactionStatus({
    txHash: duplicate.txHash,
    accountId: duplicate.signer,
    waitUntil: "FINAL",
  });
  const confirmedDuplicate = readFinalOutcome(duplicateRaw);
  assert.equal(confirmedDuplicate.txHash, duplicate.txHash);
  assert.equal(confirmedDuplicate.signer, duplicate.signer);
  assert.equal(confirmedDuplicate.ok, false);
  assert.equal(confirmedDuplicate.errorCode, "ERR_ALREADY_SETTLED");
  const duplicateTx = z
    .object({
      transaction: z.object({
        receiver_id: z.string(),
        actions: z
          .array(
            z.object({
              FunctionCall: z.object({
                method_name: z.string(),
                args: z.base64(),
                deposit: z.literal("0"),
              }),
            }),
          )
          .length(1),
      }),
    })
    .parse(duplicateRaw).transaction;
  assert.equal(duplicateTx.receiver_id, vault.contractId);
  const duplicateAction = duplicateTx.actions[0]?.FunctionCall;
  assert(duplicateAction !== undefined);
  assert.equal(
    duplicateAction.method_name,
    task.state === "SETTLED" ? "finalize_success" : "finalize_failure",
  );
  assert.deepEqual(JSON.parse(Buffer.from(duplicateAction.args, "base64").toString("utf8")), {
    task_id: taskId,
  });
  const report = {
    taskId,
    state: task.state,
    network: "testnet",
    mode: "live-ai",
    fault: input.fault,
    verified: true,
    ...(input.artifactHash === undefined ? {} : { artifactHash: input.artifactHash }),
    ...acceptance,
    model: input.model,
    recordedAt: input.recordedAt,
    vaultId: vault.contractId,
    transactions,
    ledger: { ...ledger, compensation, customer_refund: customerRefund },
    duplicateSettlement: {
      txHash: confirmedDuplicate.txHash,
      rejected: true,
      errorCode: confirmedDuplicate.errorCode,
    },
    teamControlled: true,
  };
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
