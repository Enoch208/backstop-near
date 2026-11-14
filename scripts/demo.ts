import { existsSync } from "node:fs";
import { modelFromEnv, principals } from "@backstop/agents";
import { chainBridge, createRuntime, startApi, supervise, trustAttestedModel } from "@backstop/api";
import {
  appendTestnetEntry,
  appendTestnetRun,
  chainOptionsFromEnv,
  explorerTx,
  finalizeSuccess,
  oneClickQuoter,
  getLedger,
  registerTeeSigner,
  setUpChain,
  toHex32,
} from "@backstop/near";
import { checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { formatNear, near, toYocto } from "@backstop/shared";
import { signerRecord, type Attestation } from "@backstop/tee";
import { apiClient } from "@backstop/workers";
import { capture } from "./capture.js";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");
const model = modelFromEnv(process.env);
const out = (line: string) => process.stdout.write(`${line}\n`);
const startedAt = Date.now();
const stamp = () => `+${((Date.now() - startedAt) / 1_000).toFixed(1).padStart(5, " ")}s`;

const chainFlag = process.argv.indexOf("--chain");
const network = chainFlag === -1 ? null : (process.argv[chainFlag + 1] ?? "sandbox");
const chain =
  network === null ? null : await setUpChain(chainOptionsFromEnv(network, process.env), out);
const link = (hash: string) => (network === "testnet" ? explorerTx(hash) : hash);

const runtime = createRuntime(Date.now, true);
if (process.argv.includes("--intents")) {
  runtime.intents = {
    quote: oneClickQuoter(),
    refundTo: chain?.contract.accountId ?? "backstop-vault.near",
  };
}
if (chain !== null) {
  runtime.chain = chainBridge(chain.network, chain.parties, ({ step, diverged }) => {
    const outcome = step.call.ok ? "ok" : `refused ${step.call.errorCode ?? ""}`;
    out(
      `${stamp()} [near] ${step.label}: ${outcome}${diverged ? " DIVERGED" : ""} ${link(step.call.txHash)}`,
    );
  });
}
const registerSigners = async (attestation: Attestation, modelName: string) => {
  if (chain === null) return;
  for (const signer of attestation.signers) {
    const call = await registerTeeSigner(
      chain.parties.vault,
      chain.contract,
      signer,
      modelName,
      toHex32(attestation.attestationHash),
    );
    if (call.ok && chain.network === "testnet") {
      appendTestnetEntry(chain.contract.accountId, "teeSigners", {
        txHash: call.txHash,
        ...signerRecord(attestation, signer),
      });
    }
    const outcome = call.ok ? "ok" : `refused ${call.errorCode ?? ""}`;
    out(
      `${stamp()} [near] Owner registers the attested key ${signer}: ${outcome} ${link(call.txHash)}`,
    );
  }
};
if (model !== null)
  await registerSigners(await trustAttestedModel(runtime, model.model, out), model.model);
const api = await startApi(runtime, "127.0.0.1", Number(process.env.PORT ?? "8840"));
runtime.workers = supervise(runtime, api.url, (line) => out(`${stamp()}   ${line}`));

const customer = apiClient(api.url, principals.customer);
const guarantor = apiClient(api.url, principals.guarantor);
const coordinator = apiClient(api.url, principals.coordinator);
const taskId = `checkout-live-${String(startedAt % 100_000)}`;
const recorder = process.argv.includes("--capture") ? capture(customer, taskId, startedAt) : null;

out(`Backstop live demo: ${taskId} on ${api.url}`);
const vaultMode =
  chain === null
    ? "FIXTURE vault (no NEAR moves)"
    : `NEAR ${chain.network} vault ${chain.contract.accountId} (real NEAR moves)`;
out(
  model === null
    ? `Mode: ${vaultMode}, scripted patches; real HTTP, real signed requests,`
    : `Mode: ${vaultMode}, LIVE AI patches from ${model.model}; real HTTP, signed requests,`,
);
out(
  "real worker processes, a real SIGKILL, the real verifier sandbox, challenge search and ledger.",
);

const manifest = checkoutManifest({
  taskId,
  createdAtMs: startedAt,
  maxAttempts: 3,
  timing: liveTiming,
});
await customer.post("/api/tasks", { manifest });
await customer.post(`/api/tasks/${taskId}/funding`, {
  pool: "escrow",
  amountYocto: toYocto(near("0.40")),
  liabilityYocto: null,
});
await customer.post(`/api/tasks/${taskId}/funding`, {
  pool: "premium",
  amountYocto: toYocto(near("0.04")),
  liabilityYocto: null,
});
await guarantor.post(`/api/tasks/${taskId}/funding`, {
  pool: "bond",
  amountYocto: toYocto(near("0.25")),
  liabilityYocto: toYocto(near("0.25")),
});

const eventSchema = z.object({
  version: z.int(),
  actor: z.string(),
  body: z.looseObject({ type: z.string() }),
});
let killed = false;
let closing = false;
const settled = new Promise<string>((resolve) => {
  const following = customer.follow(taskId, (raw) => {
    const event = eventSchema.parse(raw);
    if (event.body.type !== "heartbeat_recorded") recorder?.record(raw);
    out(
      `${stamp()} v${String(event.version).padStart(2, "0")} ${event.actor.padEnd(26)} ${event.body.type}`,
    );
    if (event.body.type === "checkpoint_recorded" && event.actor === "alpha" && !killed) {
      killed = true;
      out(`${stamp()}     judge: kill alpha`);
      void coordinator.post("/api/demo/faults", {
        action: "kill_worker",
        taskId,
        agentId: "alpha",
      });
    }
    if (event.body.type === "task_settled") resolve(String(event.body.kind));
  });
  following.catch((error: unknown) => {
    if (!closing)
      out(`event stream failed: ${error instanceof Error ? error.message : String(error)}`);
  });
});

const kind = await settled;
const again = await coordinator.post("/api/demo/faults", { action: "repeat_settlement", taskId });
out(`${stamp()}     judge: settle again -> HTTP ${String(again.status)}`);

if (runtime.intents !== null) {
  for (let waited = 0; waited < 20_000 && !runtime.payouts.has(taskId); waited += 200) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  for (const payout of runtime.payouts.get(taskId) ?? []) {
    const paid = formatNear(BigInt(payout.payoutYocto));
    out(
      payout.quote === null
        ? `${stamp()} [intents] ${payout.agentId}'s ${paid} NEAR payout: no quote (${payout.error ?? "unknown"})`
        : `${stamp()} [intents] ${payout.agentId}'s ${paid} NEAR payout -> ${payout.quote.quote.amountOutFormatted} ${payout.wants} to ${payout.recipient.slice(0, 10)}… in ~${String(payout.quote.quote.timeEstimate)} s (dry quote, signed ${payout.quote.signature.slice(0, 18)}…)`,
    );
  }
}

if (chain !== null) {
  const repeat = await finalizeSuccess(chain.parties.vault, chain.parties.coordinator, taskId);
  out(
    `${stamp()}     judge: settle again on NEAR -> refused ${repeat.errorCode ?? "(accepted!)"} ${link(repeat.txHash)}`,
  );
  const ledger = await getLedger(chain.parties.vault, chain.contract, taskId);
  if (chain.network === "testnet") {
    const steps = [
      ...(runtime.chain?.log ?? [])
        .filter((entry) => entry.taskId === taskId)
        .map((entry) => entry.step),
      {
        label: "A repeated settlement is refused",
        call: repeat,
        refusalExpected: true,
      },
    ];
    const killedWorker = runtime.workers.processes().find((worker) => worker.agentId === "alpha");
    appendTestnetRun(chain.contract.accountId, chain.deployTx, {
      kind: "live swarm",
      taskId,
      steps,
      extra: {
        primaryExit: killedWorker?.exit ?? null,
        ledgerState: ledger?.state ?? null,
        intentQuotes: runtime.payouts.get(taskId) ?? [],
      },
    });
    out(`${stamp()}     recorded in deployments/testnet.json`);
  }
  out(
    `${stamp()}     on-chain ledger: ${ledger?.state ?? "missing"}, in ${formatNear(BigInt(ledger?.total_inflow ?? "0"))} NEAR, confirmed out ${formatNear(BigInt(ledger?.confirmed_outflow ?? "0"))} NEAR`,
  );
}

const workers = runtime.workers;
for (
  let waited = 0;
  waited < 3_000 && workers.processes().some((worker) => worker.exit === null);
  waited += 100
) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

if (recorder !== null) {
  const path = await recorder.finish({
    network: chain?.network ?? "fixture",
    model: model?.model ?? null,
    recordedAt: new Date(startedAt).toISOString(),
  });
  out(`${stamp()}     captured the run for replay in ${path}`);
}

const view = z
  .object({
    task: z.object({ state: z.string() }),
    statement: z.object({ confirmedByRecipient: z.record(z.string(), z.string()) }),
  })
  .parse((await customer.get(`/api/tasks/${taskId}`)).body);
out("");
out(`Final state: ${view.task.state} (${kind})`);
for (const [recipient, amount] of Object.entries(view.statement.confirmedByRecipient)) {
  out(`  ${recipient.padEnd(28)} ${formatNear(BigInt(amount))} NEAR`);
}
for (const worker of workers.processes()) {
  out(
    `  worker ${worker.agentId.padEnd(8)} pid ${String(worker.pid)} exit ${worker.exit === null ? "running" : `code ${String(worker.exit.code)} signal ${String(worker.exit.signal)}`}`,
  );
}
const shutdown = async () => {
  closing = true;
  await api.close();
  await chain?.stop();
  process.exit(0);
};
if (process.argv.includes("--hold")) {
  out(`API held open on ${api.url} for the web page (pnpm web, then /live); Ctrl-C to stop`);
  process.on("SIGINT", () => void shutdown());
} else {
  await shutdown();
}
