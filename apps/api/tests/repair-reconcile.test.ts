import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lockRepairService } from "../../../scripts/repair-service/lock.js";
import {
  verifiedRecordedStep,
  verifyOriginalTask,
} from "../../../scripts/repair-service/reconcile.js";
import { submissionSchema } from "../../../scripts/repair-service/schema.js";
import { RepairJobs } from "../../../scripts/repair-service/store.js";

const directories: string[] = [];
const task = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/repair/normalize-intervals.json", import.meta.url),
    "utf8",
  ),
) as unknown;

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "backstop-reconcile-"));
  directories.push(directory);
  const store = new RepairJobs(join(directory, "jobs"));
  const submission = submissionSchema.parse({
    requestId: randomUUID(),
    repairTask: task,
    fault: "recovery-unavailable",
  });
  const { job } = store.create(submission);
  return { directory, store, job, submission };
}

function outcome(errorCode?: string) {
  return {
    final_execution_status: "FINAL",
    status:
      errorCode === undefined ? { SuccessValue: "" } : { Failure: { error_message: errorCode } },
    transaction: { hash: "recorded-hash", signer_id: "coordinator.example.testnet" },
    transaction_outcome: { outcome: { logs: [] } },
    receipts_outcome: [],
  };
}
const expected = {
  label: "Coordinator finalizes the failure settlement",
  txHash: "recorded-hash",
  signer: "coordinator.example.testnet",
  outcome: "success",
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("interrupted repair reconciliation", () => {
  it("requires final outcomes bound to the exact recorded transaction and signer", () => {
    expect(verifiedRecordedStep(outcome(), expected).call.ok).toBe(true);
    expect(() =>
      verifiedRecordedStep({ ...outcome(), final_execution_status: "EXECUTED" }, expected),
    ).toThrow();
    expect(() => verifiedRecordedStep(outcome(), { ...expected, txHash: "other-hash" })).toThrow();
    expect(() =>
      verifiedRecordedStep(outcome(), { ...expected, signer: "other.testnet" }),
    ).toThrow();
    expect(() => verifiedRecordedStep(outcome("ERR_ALREADY_SETTLED"), expected)).toThrow();
  });

  it("allows only the specific recorded deadline wait and repeated settlement refusals", () => {
    const raw = outcome("ERR_DEADLINE_NOT_REACHED");
    const step = { ...expected, outcome: "refused ERR_DEADLINE_NOT_REACHED" };
    expect(verifiedRecordedStep(raw, step).refusalExpected).toBe(true);
    expect(() => verifiedRecordedStep(raw, { ...step, label: "Other operation" })).toThrow(
      "unexplained",
    );
    expect(() =>
      verifiedRecordedStep(outcome("ERR_WRONG_SIGNER"), {
        ...expected,
        outcome: "refused ERR_WRONG_SIGNER",
      }),
    ).toThrow("unexplained");
  });

  it("refuses a changed original task bundle", () => {
    const { job, submission } = setup();
    expect(() => {
      verifyOriginalTask(job, submission.repairTask);
    }).not.toThrow();
    expect(() => {
      verifyOriginalTask(job, { ...submission.repairTask, objective: "A changed request" });
    }).toThrow("no longer matches");
  });

  it("retains an original report when finalizing from a separate reconciliation proof", () => {
    const { store, job } = setup();
    store.interrupt(job, "Reporting process failed");
    const original = store.path(job.id, "report.json");
    writeFileSync(original, "original incomplete report");
    const proof = store.path(job.id, "reconciliation.json");
    writeFileSync(
      proof,
      JSON.stringify({
        taskId: job.id,
        network: "testnet",
        mode: "live-ai",
        state: "FAILURE_SETTLED",
        verified: true,
        reconciliation: { previousError: job.error },
      }),
    );
    store.finish(job, proof);
    expect(readFileSync(original, "utf8")).toBe("original incomplete report");
    expect(job.status).toBe("completed");
    expect(JSON.stringify(job.report)).toContain("Reporting process failed");
    expect(store.artifact(job)).toBeNull();
  });

  it("cannot run while the gateway owns the same process lock", () => {
    const { directory } = setup();
    const path = join(directory, "service.lock");
    const unlock = lockRepairService(path);
    try {
      expect(() => lockRepairService(path)).toThrow("Another repair gateway");
    } finally {
      unlock();
    }
    lockRepairService(path)();
  });
});
