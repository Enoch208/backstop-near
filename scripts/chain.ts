import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runEpisode } from "@backstop/orchestrator";
import {
  defaultTestnetRpc,
  ensureSubAccounts,
  ensureVault,
  explorerTx,
  getLedger,
  parseKey,
  replayOnChain,
  startLocalChain,
  testnetParty,
  testnetRoot,
  type ChainRun,
} from "@backstop/near";
import { formatNear, fromYocto, near } from "@backstop/shared";
import type { Account } from "near-api-js";
import { z } from "zod";

const network = process.argv[2] ?? "sandbox";
const out = (line: string) => process.stdout.write(`${line}\n`);

const funding: Readonly<Record<string, bigint>> = {
  vault: near("4"),
  customer: near("1"),
  guarantor: near("0.6"),
  coordinator: near("0.5"),
  verifier: near("0.5"),
  alpha: near("0.05"),
  beta: near("0.05"),
  gamma: near("0.05"),
  delta: near("0.05"),
  epsilon: near("0.05"),
};
const names = Object.keys(funding);

async function partiesOn(): Promise<{
  root: Account;
  accounts: Record<string, Account>;
  stop: () => Promise<void>;
}> {
  if (network === "sandbox") {
    const chain = await startLocalChain();
    const accounts = await ensureSubAccounts(
      chain.root,
      names,
      (name) => (funding[name] ?? 0n) * 5n,
    );
    return { root: chain.root, accounts, stop: chain.stop };
  }
  if (network !== "testnet")
    throw new Error(`Unknown network "${network}". Use sandbox or testnet.`);
  const rootId = process.env.BACKSTOP_TESTNET_ACCOUNT;
  if (rootId === undefined)
    throw new Error("Set BACKSTOP_TESTNET_ACCOUNT to a funded testnet account you control");
  const privateKey = process.env.BACKSTOP_TESTNET_PRIVATE_KEY;
  const root = testnetRoot(
    rootId,
    privateKey === undefined ? null : parseKey(privateKey),
    process.env.BACKSTOP_TESTNET_RPC ?? defaultTestnetRpc,
  );
  const accounts: Record<string, Account> = {};
  for (const name of names) accounts[name] = await testnetParty(root, name, funding[name] ?? 0n);
  return { root, accounts, stop: () => Promise.resolve() };
}

function record(run: ChainRun, contractId: string, deployTx: string | null): void {
  mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
  const path = new URL("../deployments/testnet.json", import.meta.url);
  const previous = z
    .object({ runs: z.array(z.unknown()) })
    .safeParse(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  const runs = previous.success ? previous.data.runs : [];
  const entry = {
    at: new Date().toISOString(),
    taskId: run.taskId,
    steps: run.steps.map((step) => ({
      label: step.label,
      txHash: step.call.txHash,
      outcome: step.call.ok ? "success" : `refused ${step.call.errorCode ?? ""}`.trim(),
      explorer: explorerTx(step.call.txHash),
    })),
    rebids: run.rebids,
  };
  const document = { network: "testnet", contractId, deployTx, runs: [...runs, entry] };
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

const { accounts, stop } = await partiesOn();
const party = (name: string): Account => {
  const account = accounts[name];
  if (account === undefined) throw new Error(`No account ${name}`);
  return account;
};
try {
  const contract = party("vault");
  const roles = {
    owner: contract.accountId,
    coordinator: party("coordinator").accountId,
    verifier: party("verifier").accountId,
  };
  const prepared = await ensureVault(contract, roles);
  out(
    `Vault ${contract.accountId} on ${network}${prepared.deploy === null ? " (already deployed)" : `, deployed in ${prepared.deploy.txHash}`}`,
  );
  const taskId = `checkout-${Date.now().toString(36)}`;
  const episode = runEpisode("recovery", {
    failFirstTransfer: false,
    challengeSeed: 7,
    startMs: Date.now(),
    taskId,
  });
  out(`Replaying the verified recovery episode ${taskId} as real transactions`);
  const run = await replayOnChain(
    {
      vault: prepared.vault,
      customer: party("customer"),
      guarantor: party("guarantor"),
      coordinator: party("coordinator"),
      verifier: party("verifier"),
      payoutAccount: (agentId) => party(agentId).accountId,
    },
    episode,
  );
  for (const step of run.steps) {
    const outcome = step.call.ok ? "ok" : `refused ${step.call.errorCode ?? ""}`;
    out(
      `  ${step.label.padEnd(58)} ${outcome.padEnd(28)} ${network === "testnet" ? explorerTx(step.call.txHash) : step.call.txHash}`,
    );
  }
  const ledger = await getLedger(prepared.vault, contract, taskId);
  out(
    `On-chain ledger: ${ledger?.state ?? "missing"}, in ${formatNear(fromYocto(ledger?.total_inflow ?? "0"))} NEAR, confirmed out ${formatNear(fromYocto(ledger?.confirmed_outflow ?? "0"))} NEAR`,
  );
  for (const row of ledger?.confirmed_by_recipient ?? [])
    out(`  ${row.recipient.padEnd(40)} ${formatNear(fromYocto(row.amount))} NEAR`);
  if (network === "testnet") {
    record(run, contract.accountId, prepared.deploy?.txHash ?? null);
    out("Recorded in deployments/testnet.json");
  }
} finally {
  await stop();
}
