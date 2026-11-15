import { describe, expect, it } from "vitest";
import { checkCompensation, checkDuplicate } from "../../../scripts/compensation-proof.js";

const task = {
  task_id: "compensated",
  owner: "customer.testnet",
  guarantor: "guarantor.testnet",
  state: "FAILURE_SETTLED",
  policy: { compensation_cap: "20" },
  max_bond_liability: "30",
  bond_consumed: "20",
  inflow_escrow: "50",
  inflow_premium: "5",
  inflow_bond: "30",
  transfer_ids: ["compensated:f:0", "compensated:f:1", "compensated:f:2", "compensated:f:3"],
};
const ledger = {
  task_id: task.task_id,
  state: task.state,
  state_version: 12,
  total_inflow: "85",
  escrow_available: "0",
  premium_available: "0",
  bond_available: "0",
  bond_consumed: "20",
  pending_outflow: "0",
  failed_outflow: "0",
  confirmed_outflow: "85",
  confirmed_by_recipient: [
    { recipient: task.owner, amount: "75" },
    { recipient: task.guarantor, amount: "10" },
  ],
};
const transfers = [
  { recipient: task.owner, amount: "50", pool: "ESCROW" },
  { recipient: task.owner, amount: "20", pool: "BOND" },
  { recipient: task.owner, amount: "5", pool: "PREMIUM" },
  { recipient: task.guarantor, amount: "10", pool: "BOND" },
].map((leg, index) => ({
  ...leg,
  id: `compensated:f:${String(index)}`,
  task_id: task.task_id,
  status: "CONFIRMED",
  retries: 0,
}));
const duplicate = {
  final_execution_status: "FINAL",
  status: { Failure: { error_message: "ERR_ALREADY_SETTLED" } },
  transaction: {
    hash: "duplicate",
    signer_id: "coordinator.testnet",
    receiver_id: "vault.testnet",
    actions: [
      {
        FunctionCall: {
          method_name: "finalize_failure",
          deposit: "0",
          args: Buffer.from(JSON.stringify({ task_id: task.task_id })).toString("base64"),
        },
      },
    ],
  },
  transaction_outcome: { outcome: { logs: [] } },
  receipts_outcome: [],
};

describe("compensation evidence verification", () => {
  it("distinguishes compensation from returned customer funds", () => {
    expect(checkCompensation(task, ledger, transfers)).toMatchObject({
      compensationYocto: "20",
      customerRefundYocto: "55",
    });
  });
  it("refuses balanced settlement that diverts compensation to a worker", () => {
    const changed = transfers.map((transfer, index) =>
      index === 1 ? { ...transfer, recipient: "worker.testnet" } : transfer,
    );
    expect(() => checkCompensation(task, ledger, changed)).toThrow();
  });
  it("refuses zero-compensation refunds and unresolved transfers", () => {
    expect(() =>
      checkCompensation({ ...task, policy: { compensation_cap: "0" } }, ledger, transfers),
    ).toThrow("nonzero compensation");
    expect(() => checkCompensation(task, { ...ledger, pending_outflow: "1" }, transfers)).toThrow();
  });
  it("binds duplicate refusal to the exact task and vault", () => {
    expect(
      checkDuplicate(duplicate, "vault.testnet", task.task_id, "duplicate", "coordinator.testnet")
        .errorCode,
    ).toBe("ERR_ALREADY_SETTLED");
    expect(() =>
      checkDuplicate(duplicate, "other.testnet", task.task_id, "duplicate", "coordinator.testnet"),
    ).toThrow();
    expect(() =>
      checkDuplicate(duplicate, "vault.testnet", "other-task", "duplicate", "coordinator.testnet"),
    ).toThrow();
  });
});
