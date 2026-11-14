import { runEpisode } from "@backstop/orchestrator";
import {
  appendTestnetRun,
  chainOptionsFromEnv,
  explorerTx,
  getLedger,
  replayOnChain,
  setUpChain,
} from "@backstop/near";
import { formatNear, fromYocto } from "@backstop/shared";

const network = process.argv[2] ?? "sandbox";
const out = (line: string) => process.stdout.write(`${line}\n`);

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
    appendTestnetRun(contract.accountId, setup.deployTx, {
      kind: "replay",
      taskId: run.taskId,
      steps: run.steps,
      extra: { rebids: run.rebids },
    });
    out("Recorded in deployments/testnet.json");
  }
} finally {
  await setup.stop();
}
