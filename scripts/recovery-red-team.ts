import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import {
  appendTestnetRun,
  connectTestnetVault,
  createTask,
  defaultTestnetRpc,
  explorerTx,
  finalizeFailure,
  getLedger,
  openRecovery,
  publishedCodeHash,
  recordVerdict,
  registerAssignment,
  sendJournaled,
  toHex32,
  type ChainCall,
  type ChainStep,
  type PreparedCall,
} from "@backstop/near";
import { digestOf, near, toYocto } from "@backstop/shared";
import { Account } from "near-api-js";

const root = process.env.BACKSTOP_TESTNET_ACCOUNT;
assert(
  root !== undefined && root.endsWith(".testnet"),
  "Set BACKSTOP_TESTNET_ACCOUNT to the deployed testnet root",
);
const rpc = process.env.BACKSTOP_TESTNET_RPC ?? defaultTestnetRpc;
const {
  vault: deployedVault,
  customer,
  coordinator,
  verifier,
  payoutAccount,
} = await connectTestnetVault(root, rpc);
const observer = verifier;
const vault = {
  ...deployedVault,
  async send(signer, actions) {
    let prepared: PreparedCall | undefined;
    const remember = (call: PreparedCall) => {
      prepared = call;
    };
    try {
      return await sendJournaled(signer, deployedVault.contractId, actions, prepared, remember);
    } catch (error) {
      if (prepared === undefined) throw error;
      await wait(2_000);
      return sendJournaled(signer, deployedVault.contractId, actions, prepared, remember);
    }
  },
} satisfies typeof deployedVault;
const state = await new Account(vault.contractId, rpc).getState();
assert.equal(state.codeHash, publishedCodeHash(), "Unexpected deployed vault");
const taskId = `recovery-red-team-${Date.now().toString(36)}`;
const deadline = Date.now() + 45_000;
const escrow = near("0.05");
const hash = toHex32(digestOf(taskId));
const steps: ChainStep[] = [];

async function step(label: string, request: Promise<ChainCall>, expected?: string) {
  const call = await request;
  steps.push({ label, call, refusalExpected: expected !== undefined });
  const actual = call.ok ? undefined : call.errorCode;
  process.stdout.write(`${taskId} ${label} ${actual ?? "ok"} ${explorerTx(call.txHash)}\n`);
  assert.equal(actual, expected);
}

await step(
  "Customer funds recovery proof",
  createTask(
    vault,
    customer,
    taskId,
    hash,
    {
      maxAttempts: 3,
      deadlineNs: BigInt(deadline) * 1_000_000n,
      compensationCap: 0n,
    },
    escrow,
  ),
);

const assign = (attempt: number, agent: string) =>
  registerAssignment(vault, coordinator, taskId, {
    attempt,
    agent,
    bidHash: hash,
    payees: [{ account: agent, amount: near("0.02") }],
  });

await step("Coordinator assigns attempt 1", assign(1, payoutAccount("alpha")));
await step("Coordinator opens recovery", openRecovery(vault, coordinator, taskId, "LEASE_EXPIRED"));
await step("Coordinator assigns attempt 2", assign(2, payoutAccount("beta")));
await step(
  "Attack: verifier submits stale attempt 1",
  recordVerdict(vault, verifier, taskId, {
    attempt: 1,
    artifactHash: hash,
    suiteHash: hash,
    evidenceHash: hash,
    outcome: "ACCEPT",
  }),
  "ERR_STALE_ATTEMPT",
);
await step(
  "Attack: verifier refunds before deadline",
  finalizeFailure(vault, observer, taskId),
  "ERR_UNAUTHORIZED",
);
await wait(Math.max(0, deadline - Date.now()) + 3_000);
await step(
  "Observer refunds expired task without coordinator",
  finalizeFailure(vault, observer, taskId),
);
await step(
  "Attack: observer repeats expired task refund",
  finalizeFailure(vault, observer, taskId),
  "ERR_ALREADY_SETTLED",
);
const ledger = await getLedger(vault, observer, taskId);
assert.equal(ledger?.state, "FAILURE_SETTLED");
assert.equal(ledger.total_inflow, toYocto(escrow));
assert.equal(ledger.confirmed_outflow, toYocto(escrow));
assert.deepEqual(ledger.confirmed_by_recipient, [
  { recipient: customer.accountId, amount: toYocto(escrow) },
]);

appendTestnetRun(vault.contractId, null, {
  kind: "red team",
  taskId,
  steps,
  extra: { observer: observer.accountId, ledger },
});
