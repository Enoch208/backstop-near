import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runEpisode } from "@backstop/orchestrator";
import {
  chainOptionsFromEnv,
  explorerTx,
  getLedger,
  replayOnChain,
  setUpChain,
  type ChainRun,
} from "@backstop/near";
import { formatNear, fromYocto } from "@backstop/shared";
import { z } from "zod";

const network = process.argv[2] ?? "sandbox";
const out = (line: string) => process.stdout.write(`${line}\n`);

function record(run: ChainRun, contractId: string, deployTx: string | null): void {
  mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
  const path = new URL("../deployments/testnet.json", import.meta.url);
  const previous = z
    .object({ runs: z.array(z.unknown()), deployTx: z.string().nullable() })
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
  const knownDeploy = previous.success ? previous.data.deployTx : null;
  const document = {
    network: "testnet",
    contractId,
    deployTx: deployTx ?? knownDeploy,
    runs: [...runs, entry],
  };
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

const setup = await setUpChain(chainOptionsFromEnv(network, process.env), out);
try {
  const contract = setup.contract;
  out(
    `Vault ${contract.accountId} on ${network}${setup.deployTx === null ? " (already deployed)" : `, deployed in ${setup.deployTx}`}`,
  );
  const taskId = `checkout-${Date.now().toString(36)}`;
  const episode = runEpisode("recovery", {
    failFirstTransfer: false,
    challengeSeed: 7,
    startMs: Date.now(),
    taskId,
  });
  out(`Replaying the verified recovery episode ${taskId} as real transactions`);
  const run = await replayOnChain(setup.parties, episode);
  for (const step of run.steps) {
    const outcome = step.call.ok ? "ok" : `refused ${step.call.errorCode ?? ""}`;
    out(
      `  ${step.label.padEnd(58)} ${outcome.padEnd(28)} ${network === "testnet" ? explorerTx(step.call.txHash) : step.call.txHash}`,
    );
  }
  const ledger = await getLedger(setup.parties.vault, contract, taskId);
  out(
    `On-chain ledger: ${ledger?.state ?? "missing"}, in ${formatNear(fromYocto(ledger?.total_inflow ?? "0"))} NEAR, confirmed out ${formatNear(fromYocto(ledger?.confirmed_outflow ?? "0"))} NEAR`,
  );
  for (const row of ledger?.confirmed_by_recipient ?? [])
    out(`  ${row.recipient.padEnd(40)} ${formatNear(fromYocto(row.amount))} NEAR`);
  if (network === "testnet") {
    record(run, contract.accountId, setup.deployTx);
    out("Recorded in deployments/testnet.json");
  }
} finally {
  await setup.stop();
}
