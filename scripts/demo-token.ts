import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  deployTokenVault,
  codeHashOf,
  ensureSubAccounts,
  finalizeSuccess,
  getRoles,
  getLedger,
  getTransfer,
  loadKey,
  readFinalOutcome,
  startLocalChain,
  vaultWasmPath,
  type ChainSetup,
  type Vault,
} from "@backstop/near";
import { near } from "@backstop/shared";
import { tsxLoader, workerEntry } from "@backstop/workers";
import { Account, actions, JsonRpcProvider, teraToGas } from "near-api-js";
import { z } from "zod";

export const tokenDemoBudget = {
  escrow: near("1"),
  premium: near("0.10"),
  bond: near("0.40"),
  payout: 1_200_000n,
} as const;

export async function verifyTokenRescue(chain: ChainSetup, taskId: string) {
  const { vault, coordinator, payoutAccount } = chain.parties;
  const ledger = await getLedger(vault, chain.contract, taskId);
  assert.equal(ledger?.state, "SETTLED");
  assert.equal(ledger.total_inflow, "1500000");
  assert.equal(ledger.confirmed_outflow, ledger.total_inflow);
  assert.equal(ledger.bond_consumed, "200000");
  assert.equal(ledger.pending_outflow, "0");
  assert.equal(ledger.failed_outflow, "0");
  const winner = payoutAccount("beta");
  assert(
    ledger.confirmed_by_recipient.some(
      ({ recipient, amount }) => recipient === winner && BigInt(amount) === tokenDemoBudget.payout,
    ),
  );
  for (const [index, pool, amount] of [
    [0, "ESCROW", "1000000"],
    [1, "BOND", "200000"],
  ] as const) {
    const transfer = await getTransfer(vault, chain.contract, `${taskId}:2:${String(index)}`);
    assert.equal(transfer?.status, "CONFIRMED");
    assert.equal(transfer.pool, pool);
    assert.equal(transfer.amount, amount);
    assert.equal(transfer.recipient, winner);
  }
  const duplicate = await finalizeSuccess(vault, coordinator, taskId);
  assert.equal(duplicate.errorCode, "ERR_ALREADY_SETTLED");
  return { ledger, duplicate };
}

const usdcContracts = {
  testnet: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
  mainnet: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
};
const usdcRoleNames = [
  "vault",
  "customer",
  "guarantor",
  "coordinator",
  "verifier",
  "alpha",
  "beta",
  "gamma",
] as const;
export async function setUpUsdcDemo(
  network: "testnet" | "mainnet",
  root: string,
  taskId: string,
): Promise<ChainSetup> {
  assert(
    root.endsWith(network === "testnet" ? ".testnet" : ".near"),
    "Use a dedicated named account on the selected chain",
  );
  const endpoint =
    process.env.BACKSTOP_USDC_RPC ??
    (network === "testnet" ? "https://near-testnet.drpc.org" : "https://free.rpc.fastnear.com");
  const provider = new JsonRpcProvider({ url: endpoint });
  const token = { contractId: usdcContracts[network], unitsPerBaseUnit: 10n ** 18n };
  const args = { finality: "final" } as const;
  const metadata = z.object({ symbol: z.literal("USDC"), decimals: z.literal(6) }).parse(
    await provider.callFunction({
      contractId: token.contractId,
      method: "ft_metadata",
      args: {},
      blockQuery: args,
    }),
  );
  const party = (name: string) => {
    const accountId = `${name}.${root}`;
    const key = loadKey(network, accountId);
    if (key === null) throw new Error(`Missing signer for ${accountId}`);
    return new Account(accountId, provider, key);
  };
  const contract = party("vault");
  const customer = party("customer");
  const guarantor = party("guarantor");
  const coordinator = party("coordinator");
  const verifier = party("verifier");
  const vault = { contractId: contract.accountId, token };
  const accounts = usdcRoleNames.map((name) => `${name}.${root}`);
  await Promise.all(accounts.map((accountId) => provider.viewAccount({ accountId })));
  for (const [name, minimum] of [
    ["customer", 1_100_000n],
    ["guarantor", 400_000n],
  ] as const) {
    const amount = await provider.callFunction({
      contractId: token.contractId,
      method: "ft_balance_of",
      args: { account_id: `${name}.${root}` },
      blockQuery: args,
    });
    assert(
      BigInt(z.string().parse(amount)) >= minimum,
      `${name}.${root} needs more ${metadata.symbol}`,
    );
  }
  const registered = ["vault", "customer", "guarantor", "alpha", "beta", "gamma"];
  await Promise.all(
    registered.map(async (name) => {
      const accountId = `${name}.${root}`;
      const balance = await provider.callFunction({
        contractId: token.contractId,
        method: "storage_balance_of",
        args: { account_id: accountId },
        blockQuery: args,
      });
      assert(
        balance !== undefined && balance !== null,
        `Register ${accountId} on the ${metadata.symbol} contract first`,
      );
    }),
  );
  const wasm = readFileSync(vaultWasmPath);
  const roles = {
    owner: contract.accountId,
    coordinator: coordinator.accountId,
    verifier: verifier.accountId,
  };
  const { codeHash } = await contract.getState();
  let deployTx: string | null = null;
  if (codeHash === codeHashOf(wasm)) {
    assert.deepEqual(await getRoles(vault, contract), roles);
    const configured = await provider.callFunction({
      contractId: contract.accountId,
      method: "get_token_asset",
      args: {},
      blockQuery: args,
    });
    assert.deepEqual(configured, { token_contract: token.contractId, min_escrow: "10000" });
    assert.equal(await getLedger(vault, customer, taskId), null, "Use a fresh task id");
  } else {
    const deploy = await deployTokenVault(contract, roles, token, wasm);
    assert(deploy.ok, `USDC vault deployment failed at ${deploy.txHash}`);
    deployTx = deploy.txHash;
  }
  process.stdout.write(
    `USDC vault ${contract.accountId} on ${network}${deployTx === null ? "" : ` deployed in ${deployTx}`}\n`,
  );
  return {
    network,
    contract,
    deployTx,
    stop: () => Promise.resolve(),
    parties: {
      vault,
      customer,
      guarantor,
      coordinator,
      verifier,
      payoutAccount: (agentId) => `${agentId}.${root}`,
    },
  };
}

export async function setUpTokenDemo(fixturePath: string): Promise<ChainSetup> {
  const wasm = readFileSync(fixturePath);
  assert.equal(
    createHash("sha256").update(wasm).digest("hex"),
    "bf42d41cfe1ee902c117f198f39456c7c5aec37969ee0fd52057cee52a357f55",
    "Unexpected wNEAR fixture",
  );
  const chain = await startLocalChain();
  try {
    const accounts = await ensureSubAccounts(
      chain.root,
      [
        "vault",
        "token",
        "customer",
        "guarantor",
        "coordinator",
        "verifier",
        "alpha",
        "beta",
        "gamma",
      ],
      () => near("8"),
    );
    const party = (name: string) => {
      const account = accounts[name];
      assert(account !== undefined, `Missing demo account ${name}`);
      return account;
    };
    const token = party("token");
    const contract = party("vault");
    const customer = party("customer");
    const guarantor = party("guarantor");
    const coordinator = party("coordinator");
    const verifier = party("verifier");
    const sendToken = async (
      signer: Account,
      calls: Parameters<Account["signAndSendTransaction"]>[0]["actions"],
    ) => {
      const call = readFinalOutcome(
        await signer.signAndSendTransaction({
          receiverId: token.accountId,
          actions: calls,
          waitUntil: "FINAL",
          throwOnFailure: false,
        }),
      );
      assert(call.ok, `Sandbox token setup failed at ${call.txHash}`);
    };
    await sendToken(token, [
      actions.deployContract(wasm),
      actions.functionCall("new", {}, teraToGas("45"), 0n),
    ]);
    const asset = { contractId: token.accountId, unitsPerBaseUnit: 10n ** 18n };
    const vault: Vault = { contractId: contract.accountId, token: asset };
    const deploy = await deployTokenVault(
      contract,
      {
        owner: contract.accountId,
        coordinator: coordinator.accountId,
        verifier: verifier.accountId,
      },
      asset,
    );
    assert(deploy.ok, `Sandbox token vault deployment failed at ${deploy.txHash}`);
    for (const name of ["vault", "customer", "guarantor", "alpha", "beta", "gamma"]) {
      await sendToken(chain.root, [
        actions.functionCall(
          "storage_deposit",
          {
            account_id: party(name).accountId,
            registration_only: true,
          },
          teraToGas("45"),
          near("0.01"),
        ),
      ]);
    }
    for (const signer of [customer, guarantor]) {
      await sendToken(signer, [
        actions.functionCall("near_deposit", {}, teraToGas("45"), near("0.01")),
      ]);
    }
    return {
      network: "sandbox",
      contract,
      deployTx: deploy.txHash,
      stop: chain.stop,
      parties: {
        vault,
        customer,
        guarantor,
        coordinator,
        verifier,
        payoutAccount: (agentId) => party(agentId).accountId,
      },
    };
  } catch (error) {
    await chain.stop();
    throw error;
  }
}

export function tokenDemoWorkers(
  api: string,
  task: string,
  chain: ChainSetup,
  log: (line: string) => void,
) {
  return [
    { id: "token-beta", account: "beta", floor: "0.96" },
    { id: "token-gamma", account: "gamma", floor: "1.024" },
  ].map(({ id, account, floor }) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        tsxLoader,
        workerEntry,
        "--agent",
        id,
        "--api",
        api,
        "--task",
        task,
        "--account",
        chain.parties.payoutAccount(account),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          BACKSTOP_WORKER_SEED: randomUUID(),
          BACKSTOP_WORKER_FLOOR_NEAR: floor,
          BACKSTOP_WORKER_RISK_BPS: "20000",
          BACKSTOP_WORKER_CAPACITY: "10",
          BACKSTOP_WORKER_MS_PER_UNIT: "10000",
        },
      },
    );
    child.stdout.on("data", (data: Buffer) => log(data.toString().trimEnd()));
    child.stderr.on("data", (data: Buffer) => log(data.toString().trimEnd()));
    child.on("error", (error) => log(`${id} failed to start: ${error.message}`));
    return child;
  });
}
