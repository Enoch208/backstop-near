import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { actions, teraToGas, type Account } from "near-api-js";
import {
  ensureSubAccounts,
  finalizeFailure,
  finalizeSuccess,
  getLedger,
  getTransfer,
  openRecovery,
  readFinalOutcome,
  recordVerdict,
  registerAssignment,
  retryFailedTransfer,
  startLocalChain,
  toHex32,
  vaultWasmPath,
} from "@backstop/near";
import { digestOf, near } from "@backstop/shared";
const tokenPath = process.argv[2];
assert(tokenPath !== undefined, "Pass the verified wNEAR fixture path");
const fixture = readFileSync(tokenPath);
assert.equal(
  createHash("sha256").update(fixture).digest("hex"),
  "bf42d41cfe1ee902c117f198f39456c7c5aec37969ee0fd52057cee52a357f55",
);
const chain = await startLocalChain();
try {
  const parties = await ensureSubAccounts(
    chain.root,
    ["vault", "token", "customer", "guarantor", "coordinator", "verifier", "worker"],
    () => near("9"),
  );
  const { vault: contract, token, customer, guarantor, coordinator, verifier, worker } = parties;
  assert(contract && token && customer && guarantor && coordinator && verifier && worker);
  const vault = { contractId: contract.accountId };
  async function send(
    account: Account,
    receiverId: string,
    method: string,
    args: Record<string, unknown>,
    gas: `${number}` = "45",
    deposit = 0n,
  ) {
    return readFinalOutcome(
      await account.signAndSendTransaction({
        receiverId,
        actions: [actions.functionCall(method, args, teraToGas(gas), deposit)],
        waitUntil: "FINAL",
        throwOnFailure: false,
      }),
    );
  }
  async function deploy(
    account: Account,
    wasm: Uint8Array,
    method: string,
    args: Record<string, unknown>,
  ) {
    const result = readFinalOutcome(
      await account.signAndSendTransaction({
        receiverId: account.accountId,
        actions: [
          actions.deployContract(wasm),
          actions.functionCall(method, args, teraToGas("45"), 0n),
        ],
        waitUntil: "FINAL",
        throwOnFailure: false,
      }),
    );
    assert.equal(result.ok, true, result.errorCode ?? "");
    return result;
  }
  await deploy(token, fixture, "new", {});
  await deploy(contract, readFileSync(vaultWasmPath), "new_with_token", {
    token_contract: token.accountId,
    min_escrow: "10000",
    owner: contract.accountId,
    coordinator: coordinator.accountId,
    verifier: verifier.accountId,
  });
  const callToken = (
    account: Account,
    method: string,
    args: Record<string, unknown>,
    gas: `${number}` = "45",
    deposit = 0n,
  ) => send(account, token.accountId, method, args, gas, deposit);
  const balance = async (account: Account) => {
    const amount = await token.provider.callFunction<string>({
      contractId: token.accountId,
      method: "ft_balance_of",
      args: { account_id: account.accountId },
    });
    assert(amount !== undefined, "Token contract returned no balance");
    return BigInt(amount);
  };
  async function register(account: Account) {
    assert(
      (
        await callToken(
          chain.root,
          "storage_deposit",
          { account_id: account.accountId, registration_only: true },
          "45",
          near("0.01"),
        )
      ).ok,
    );
  }
  for (const account of [contract, customer, guarantor]) await register(account);
  for (const account of [customer, guarantor])
    assert((await callToken(account, "near_deposit", {}, "45", near("0.1"))).ok);
  const taskId = "token-recovery";
  const hash = toHex32(digestOf(taskId));
  const amounts = { escrow: 1_000_000n, bond: 400_000n, premium: 100_000n, payout: 1_200_000n };
  const deadline = Date.now() + 120_000;
  const policy = {
    deadline_ns: (BigInt(deadline) * 1_000_000n).toString(),
    max_attempts: 2,
    compensation_cap: "100000",
  };
  const beforeCustomer = await balance(customer);
  const beforeGuarantor = await balance(guarantor);
  const fund = (signer: Account, id: string, amount: bigint, msg: Record<string, unknown>) =>
    callToken(
      signer,
      "ft_transfer_call",
      {
        receiver_id: contract.accountId,
        amount: amount.toString(),
        msg: JSON.stringify({ task_id: id, ...msg }),
      },
      "130",
      1n,
    );
  const native = await send(
    customer,
    vault.contractId,
    "create_task",
    { task_id: taskId, manifest_hash: hash, policy },
    "45",
    near("0.01"),
  );
  assert.equal(native.errorCode, "ERR_WRONG_FUNDING_ASSET");
  const forged = await send(customer, vault.contractId, "ft_on_transfer", {
    sender_id: customer.accountId,
    amount: "1000000",
    msg: JSON.stringify({ operation: "create", task_id: taskId, manifest_hash: hash, policy }),
  });
  assert.equal(forged.errorCode, "ERR_WRONG_TOKEN_CONTRACT");
  assert(
    (
      await fund(customer, taskId, amounts.escrow, {
        operation: "create",
        manifest_hash: hash,
        policy,
      })
    ).ok,
  );
  assert((await fund(customer, taskId, amounts.premium, { operation: "premium" })).ok);
  assert(
    (
      await fund(guarantor, taskId, amounts.bond, {
        operation: "guarantee",
        max_liability: amounts.bond.toString(),
      })
    ).ok,
  );
  const funded = await getLedger(vault, customer, taskId);
  assert.equal(funded?.total_inflow, "1500000");
  assert.equal(await balance(contract), 1_500_000n);
  const wrongPayer = await fund(guarantor, taskId, 50_000n, { operation: "escrow" });
  assert.equal(wrongPayer.ok, true);
  assert.equal(
    await balance(guarantor),
    beforeGuarantor - amounts.bond,
    "Rejected deposit was refunded",
  );
  assert.equal(await balance(contract), 1_500_000n);
  const assign = (attempt: number, payee: Account, amount: bigint) =>
    registerAssignment(vault, coordinator, taskId, {
      attempt,
      agent: payee.accountId,
      bidHash: hash,
      payees: [{ account: payee.accountId, amount }],
    });
  assert((await assign(1, worker, amounts.escrow)).ok);
  assert((await openRecovery(vault, coordinator, taskId, "LEASE_EXPIRED")).ok);
  assert((await assign(2, worker, amounts.payout)).ok);
  const verdict = await recordVerdict(vault, verifier, taskId, {
    attempt: 2,
    artifactHash: hash,
    suiteHash: hash,
    evidenceHash: hash,
    outcome: "ACCEPT",
  });
  assert(verdict.ok);
  assert((await finalizeSuccess(vault, coordinator, taskId)).ok);
  const ledgerWith = async (
    condition: (ledger: NonNullable<Awaited<ReturnType<typeof getLedger>>>) => boolean,
    id = taskId,
  ) => {
    for (let retry = 0; retry < 24; retry++) {
      const ledger = await getLedger(vault, customer, id);
      if (ledger !== null && condition(ledger)) return ledger;
      await wait(500);
    }
    throw new Error(JSON.stringify(await getLedger(vault, customer, id)));
  };
  const failed = await ledgerWith((ledger) => ledger.pending_outflow === "0");
  assert.equal(failed?.failed_outflow, amounts.payout.toString());
  await register(worker);
  for (const id of [taskId + ":2:0", taskId + ":2:1"]) {
    assert.equal((await getTransfer(vault, customer, id))?.status, "FAILED");
    assert((await retryFailedTransfer(vault, verifier, id)).ok);
    await ledgerWith((ledger) => ledger.pending_outflow === "0");
    assert.equal((await getTransfer(vault, customer, id))?.status, "CONFIRMED");
  }
  const settled = await getLedger(vault, customer, taskId);
  assert.equal(settled?.state, "SETTLED");
  assert.equal(settled.confirmed_outflow, settled.total_inflow);
  assert.equal(settled.bond_consumed, "200000");
  assert.equal(await balance(contract), 0n);
  assert.equal(await balance(worker), amounts.payout);
  assert.equal(await balance(customer), beforeCustomer - amounts.escrow);
  assert.equal(await balance(guarantor), beforeGuarantor - 200_000n);
  assert.equal(
    (await finalizeSuccess(vault, coordinator, taskId)).errorCode,
    "ERR_ALREADY_SETTLED",
  );

  const failureId = "token-terminal";
  const preFailureCustomer = await balance(customer);
  const preFailureGuarantor = await balance(guarantor);
  assert(
    (
      await fund(customer, failureId, amounts.escrow, {
        operation: "create",
        manifest_hash: hash,
        policy: { ...policy, max_attempts: 1 },
      })
    ).ok,
  );
  assert(
    (
      await fund(guarantor, failureId, amounts.bond, {
        operation: "guarantee",
        max_liability: amounts.bond.toString(),
      })
    ).ok,
  );
  assert(
    (
      await registerAssignment(vault, coordinator, failureId, {
        attempt: 1,
        agent: worker.accountId,
        bidHash: hash,
        payees: [{ account: worker.accountId, amount: amounts.escrow }],
      })
    ).ok,
  );
  assert((await openRecovery(vault, coordinator, failureId, "LEASE_EXPIRED")).ok);
  assert((await finalizeFailure(vault, coordinator, failureId)).ok);
  const refunded = await ledgerWith((ledger) => ledger.state === "FAILURE_SETTLED", failureId);
  assert.equal(refunded.total_inflow, refunded.confirmed_outflow);
  assert.equal(refunded.bond_consumed, "100000");
  assert.equal(await balance(contract), 0n);
  assert.equal(await balance(customer), preFailureCustomer + 100_000n);
  assert.equal(await balance(guarantor), preFailureGuarantor - 100_000n);
  assert.equal(
    (await finalizeFailure(vault, coordinator, failureId)).errorCode,
    "ERR_ALREADY_SETTLED",
  );
  process.stdout.write(
    "Sandbox token rescue passed: spoof refused, rejected deposit refunded, failed FT payouts retried, bond-backed payout and full refund with compensation confirmed, duplicates refused.\n",
  );
} finally {
  await chain.stop();
}
