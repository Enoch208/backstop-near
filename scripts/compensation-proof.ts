import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  ledgerViewSchema,
  publishedCodeHash,
  readFinalOutcome,
  testnetProofProvider,
  transferViewSchema,
} from "@backstop/near";
import { yoctoSchema } from "@backstop/shared";
import { z } from "zod";

const taskSchema = z.object({
  task_id: z.string(),
  owner: z.string(),
  guarantor: z.string(),
  state: z.literal("FAILURE_SETTLED"),
  policy: z.object({ compensation_cap: yoctoSchema }),
  max_bond_liability: yoctoSchema,
  bond_consumed: yoctoSchema,
  inflow_escrow: yoctoSchema,
  inflow_premium: yoctoSchema,
  inflow_bond: yoctoSchema,
  transfer_ids: z.array(z.string()),
});

export function checkCompensation(
  taskInput: unknown,
  ledgerInput: unknown,
  transfersInput: unknown,
) {
  const task = taskSchema.parse(taskInput);
  const ledger = ledgerViewSchema.parse(ledgerInput);
  const transfers = z.array(transferViewSchema).parse(transfersInput);
  const escrow = BigInt(task.inflow_escrow);
  const premium = BigInt(task.inflow_premium);
  const bond = BigInt(task.inflow_bond);
  const liability = BigInt(task.max_bond_liability);
  const cap = BigInt(task.policy.compensation_cap);
  assert(liability <= bond, "Liability exceeds deposited collateral");
  const compensation = [bond, liability, cap].reduce((a, b) => (a < b ? a : b));
  assert(compensation > 0n, "This task does not prove nonzero compensation");
  assert.notEqual(task.owner, task.guarantor, "Customer and guarantor must be distinct");
  assert.equal(ledger.task_id, task.task_id);
  assert.equal(ledger.state, "FAILURE_SETTLED");
  assert.equal(ledger.bond_consumed, compensation.toString());
  assert.equal(task.bond_consumed, compensation.toString());
  assert.equal(ledger.total_inflow, (escrow + premium + bond).toString());
  assert.equal(ledger.confirmed_outflow, ledger.total_inflow);
  for (const value of [
    ledger.pending_outflow,
    ledger.failed_outflow,
    ledger.escrow_available,
    ledger.premium_available,
    ledger.bond_available,
  ])
    assert.equal(value, "0");
  assert.equal(new Set(task.transfer_ids).size, task.transfer_ids.length);
  assert.deepEqual(
    transfers.map(({ id }) => id),
    task.transfer_ids,
  );
  const expected = [
    { recipient: task.owner, amount: escrow, pool: "ESCROW" },
    { recipient: task.owner, amount: compensation, pool: "BOND" },
    { recipient: task.owner, amount: premium, pool: "PREMIUM" },
    { recipient: task.guarantor, amount: bond - compensation, pool: "BOND" },
  ]
    .filter(({ amount }) => amount > 0n)
    .map(({ amount, ...leg }) => ({ ...leg, amount: amount.toString() }));
  assert.deepEqual(
    transfers.map(({ id, task_id, recipient, amount, pool, status }, index) => {
      assert.equal(id, `${task.task_id}:f:${String(index)}`);
      assert.equal(task_id, task.task_id);
      assert.equal(status, "CONFIRMED");
      return { recipient, amount, pool };
    }),
    expected,
  );
  const recipients = [
    { recipient: task.owner, amount: (escrow + premium + compensation).toString() },
    ...(bond === compensation
      ? []
      : [{ recipient: task.guarantor, amount: (bond - compensation).toString() }]),
  ].sort((a, b) => a.recipient.localeCompare(b.recipient));
  assert.deepEqual(
    [...ledger.confirmed_by_recipient].sort((a, b) => a.recipient.localeCompare(b.recipient)),
    recipients,
  );
  return {
    task,
    ledger,
    transfers,
    compensationYocto: compensation.toString(),
    customerRefundYocto: (escrow + premium).toString(),
  };
}

export function checkDuplicate(
  raw: unknown,
  contractId: string,
  taskId: string,
  txHash: string,
  signer: string,
) {
  const tx = z
    .object({
      transaction: z.object({
        receiver_id: z.string(),
        actions: z
          .array(
            z.object({
              FunctionCall: z.object({
                method_name: z.literal("finalize_failure"),
                args: z.base64(),
                deposit: z.literal("0"),
              }),
            }),
          )
          .length(1),
      }),
    })
    .parse(raw).transaction;
  assert.equal(tx.receiver_id, contractId);
  const call = tx.actions[0]?.FunctionCall;
  assert(call !== undefined);
  assert.deepEqual(JSON.parse(Buffer.from(call.args, "base64").toString("utf8")), {
    task_id: taskId,
  });
  const outcome = readFinalOutcome(raw);
  assert.equal(outcome.txHash, txHash);
  assert.equal(outcome.signer, signer);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "ERR_ALREADY_SETTLED");
  return outcome;
}

async function main() {
  const { values } = parseArgs({
    options: {
      vault: { type: "string" },
      task: { type: "string" },
      output: { type: "string" },
      "duplicate-tx": { type: "string" },
      "duplicate-signer": { type: "string" },
    },
  });
  const contractId = z.string().endsWith(".testnet").parse(values.vault);
  const taskId = z.string().min(1).parse(values.task);
  assert.equal(
    values["duplicate-tx"] === undefined,
    values["duplicate-signer"] === undefined,
    "Supply both --duplicate-tx and --duplicate-signer",
  );
  const provider = testnetProofProvider(process.env.BACKSTOP_TESTNET_RPC);
  const state = await provider.viewAccount({
    accountId: contractId,
    blockQuery: { finality: "final" },
  });
  assert.equal(
    state.code_hash,
    publishedCodeHash(),
    "Deployed code differs from the published build",
  );
  const read = (method: string, args: Record<string, string>) =>
    provider.callFunction({
      contractId,
      method,
      args,
      blockQuery: { finality: "final" },
    });
  const task = taskSchema.parse(await read("get_task", { task_id: taskId }));
  assert.equal(task.task_id, taskId);
  const ledger = await read("get_ledger", { task_id: taskId });
  const transfers = [];
  for (const id of task.transfer_ids)
    transfers.push(await read("get_transfer", { transfer_id: id }));
  const proof = checkCompensation(task, ledger, transfers);
  const txHash = values["duplicate-tx"];
  const signer = values["duplicate-signer"];
  const duplicate =
    txHash === undefined || signer === undefined
      ? null
      : checkDuplicate(
          await provider.viewTransactionStatus({ txHash, accountId: signer, waitUntil: "FINAL" }),
          contractId,
          taskId,
          txHash,
          signer,
        );
  const result = {
    version: "backstop-compensation-proof-1",
    checkedAt: new Date().toISOString(),
    network: "testnet",
    mode: "read-only settlement verification",
    contractId,
    taskId,
    codeHash: state.code_hash,
    scope:
      "Checks public settlement state. Does not establish live inference, independent operators, artifact rejection or a benchmark result.",
    ...proof,
    duplicate,
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output !== undefined) writeFileSync(resolve(values.output), output, { flag: "wx" });
  process.stdout.write(output);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
