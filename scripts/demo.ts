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
import { formatNear, near, toYocto } from "@backstop/shared";
import { signerRecord, type Attestation } from "@backstop/tee";
import { apiClient } from "@backstop/workers";
import { capture } from "./capture.js";
import { checked, confirmKill, deliver, demoManifest, demoOptions } from "./repair-demo.js";
import {
  setUpTokenDemo,
  setUpUsdcDemo,
  tokenDemoBudget,
  tokenDemoWorkers,
  verifyTokenRescue,
} from "./demo-token.js";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");
const model = modelFromEnv(process.env);
const options = demoOptions();
if (options.task !== undefined && model === null) {
  throw new Error("--task requires BACKSTOP_AI_API_KEY for the live workers");
}
if (options.output !== undefined && existsSync(options.output)) {
  throw new Error("--output must point to a new file");
}
const out = (line: string) => process.stdout.write(`${line}\n`);
const startedAt = Date.now();
const stamp = () => `+${((Date.now() - startedAt) / 1_000).toFixed(1).padStart(5, " ")}s`;
const taskId =
  options.taskId ??
  (options.task === undefined
    ? `checkout-live-${String(startedAt % 100_000)}`
    : `repair-${crypto.randomUUID().slice(0, 8)}`);

const chainFlag = process.argv.indexOf("--chain");
const network = chainFlag === -1 ? null : (process.argv[chainFlag + 1] ?? "sandbox");
const chain =
  options.tokenFixture !== undefined
    ? await setUpTokenDemo(options.tokenFixture)
    : options.usdcRoot !== undefined && (network === "mainnet" || network === "testnet")
      ? await setUpUsdcDemo(network, options.usdcRoot, taskId)
      : network === null
        ? null
        : await setUpChain(chainOptionsFromEnv(network, process.env), out);
const tokenDemo = chain !== null && chain.parties.vault.token !== undefined;
const assetLabel =
  options.usdcRoot !== undefined ? "USDC" : tokenDemo ? "sandbox token units" : "NEAR";
if (tokenDemo) process.env.BACKSTOP_WORKER_CURRENCY = assetLabel;
const link = (hash: string) =>
  network === "testnet"
    ? explorerTx(hash)
    : network === "mainnet"
      ? `https://nearblocks.io/txns/${hash}`
      : hash;

const runtime = createRuntime(
  Date.now,
  true,
  options.usdcRoot === undefined
    ? options.external
      ? process.env.BACKSTOP_STATE_PATH
      : undefined
    : (process.env.BACKSTOP_USDC_STATE_PATH ?? `.backstop/usdc-${taskId}.sqlite`),
);
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
    if (call.ok && chain.network === "testnet" && !tokenDemo) {
      appendTestnetEntry(chain.contract.accountId, "teeSigners", {
        txHash: call.txHash,
        ...signerRecord(attestation, signer),
      });
    }
    if (!call.ok && tokenDemo)
      throw new Error(`Token vault refused the attested signer at ${link(call.txHash)}`);
    const outcome = call.ok ? "ok" : `refused ${call.errorCode ?? ""}`;
    out(
      `${stamp()} [near] Owner registers the attested key ${signer}: ${outcome} ${link(call.txHash)}`,
    );
  }
};
if (model !== null)
  await registerSigners(await trustAttestedModel(runtime, model.model, out), model.model);
const api = await startApi(runtime, "127.0.0.1", Number(process.env.PORT ?? "8840"));
runtime.workers = supervise(
  runtime,
  api.url,
  (line) => out(`${stamp()}   ${line}`),
  options.external || tokenDemo ? ["alpha", "kappa"] : undefined,
);

const customer = apiClient(api.url, principals.customer);
const guarantor = apiClient(api.url, principals.guarantor);
const coordinator = apiClient(api.url, principals.coordinator);
const recorder = process.argv.includes("--capture") ? capture(customer, taskId, startedAt) : null;
const tokenWorkers = tokenDemo
  ? tokenDemoWorkers(api.url, taskId, chain, (line) => out(`${stamp()}   ${line}`))
  : [];

out(`Backstop live demo: ${taskId} on ${api.url}`);
const vaultMode =
  chain === null
    ? "FIXTURE vault (no NEAR moves)"
    : `NEAR ${chain.network} vault ${chain.contract.accountId} (${assetLabel})`;
out(
  model === null
    ? `Mode: ${vaultMode}, scripted patches; real HTTP, real signed requests,`
    : `Mode: ${vaultMode}, LIVE AI patches from ${model.model}; real HTTP, signed requests,`,
);
out(
  "real worker processes, a real SIGKILL, the real verifier sandbox, challenge search and ledger.",
);

const originalManifest = demoManifest(options, taskId, startedAt);
const manifest = tokenDemo
  ? {
      ...originalManifest,
      budget: {
        escrowYocto: toYocto(tokenDemoBudget.escrow),
        premiumYocto: toYocto(tokenDemoBudget.premium),
      },
      guarantee: {
        maxLiabilityYocto: toYocto(tokenDemoBudget.bond),
        compensationCapYocto: toYocto(near("0.10")),
      },
    }
  : originalManifest;
await checked(
  customer.post("/api/tasks", {
    manifest,
    ...(options.task === undefined ? {} : { repairTask: options.task }),
  }),
  "Create task",
);
await checked(
  customer.post(`/api/tasks/${taskId}/funding`, {
    pool: "escrow",
    amountYocto: manifest.budget.escrowYocto,
    liabilityYocto: null,
  }),
  "Fund escrow",
);
await checked(
  customer.post(`/api/tasks/${taskId}/funding`, {
    pool: "premium",
    amountYocto: manifest.budget.premiumYocto,
    liabilityYocto: null,
  }),
  "Fund premium",
);
await checked(
  guarantor.post(`/api/tasks/${taskId}/funding`, {
    pool: "bond",
    amountYocto: manifest.guarantee?.maxLiabilityYocto ?? toYocto(near("0.25")),
    liabilityYocto: manifest.guarantee?.maxLiabilityYocto ?? toYocto(near("0.25")),
  }),
  "Post bond",
);

const eventSchema = z.object({
  version: z.int(),
  actor: z.string(),
  body: z.looseObject({ type: z.string() }),
});
let killed = false;
let closing = false;
const killPrimary = async () => {
  if (options.manualKill) await confirmKill();
  out(`${stamp()}     judge: kill alpha`);
  await checked(
    coordinator.post("/api/demo/faults", { action: "kill_worker", taskId, agentId: "alpha" }),
    "Kill the primary worker",
  );
};
const settled = new Promise<string>((resolve, reject) => {
  const following = customer.follow(taskId, (raw) => {
    const event = eventSchema.parse(raw);
    if (event.body.type !== "heartbeat_recorded") recorder?.record(raw);
    out(
      `${stamp()} v${String(event.version).padStart(2, "0")} ${event.actor.padEnd(26)} ${event.body.type}`,
    );
    if (event.body.type === "checkpoint_recorded" && event.actor === "alpha" && !killed) {
      killed = true;
      void killPrimary().catch(reject);
    }
    if (event.body.type === "task_settled") resolve(String(event.body.kind));
  });
  following.then(
    () => {
      if (!closing) reject(new Error("The task event stream closed before settlement"));
    },
    (error: unknown) => {
      if (!closing) reject(error instanceof Error ? error : new Error(String(error)));
    },
  );
});

const stop = async () => {
  closing = true;
  for (const worker of tokenWorkers) worker.kill();
  await api.close();
  await chain?.stop();
};
const kind = await settled.catch(async (error: unknown) => {
  await stop();
  throw error;
});
if (options.task !== undefined && kind === "success") {
  const path = options.output ?? `${taskId}.js`;
  const hash = await deliver(customer, taskId, path);
  out(`${stamp()}     downloaded verified source to ${path} (${hash})`);
}
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
  const proof = tokenDemo
    ? await verifyTokenRescue(chain, taskId).catch(async (error: unknown) => {
        await stop();
        throw error;
      })
    : null;
  const repeat =
    proof?.duplicate ??
    (await finalizeSuccess(chain.parties.vault, chain.parties.coordinator, taskId));
  out(
    `${stamp()}     judge: settle again on NEAR -> refused ${repeat.errorCode ?? "(accepted!)"} ${link(repeat.txHash)}`,
  );
  const ledger = proof?.ledger ?? (await getLedger(chain.parties.vault, chain.contract, taskId));
  if (chain.network === "testnet" && !tokenDemo) {
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
  if (tokenDemo) {
    out(
      `${stamp()}     token ledger: ${ledger?.state ?? "missing"}, in ${ledger?.total_inflow ?? "0"} base units, out ${ledger?.confirmed_outflow ?? "0"} base units, bond spent ${ledger?.bond_consumed ?? "0"} base units`,
    );
  } else {
    out(
      `${stamp()}     on-chain ledger: ${ledger?.state ?? "missing"}, in ${formatNear(BigInt(ledger?.total_inflow ?? "0"))} NEAR, confirmed out ${formatNear(BigInt(ledger?.confirmed_outflow ?? "0"))} NEAR`,
    );
  }
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
  out(`  ${recipient.padEnd(28)} ${formatNear(BigInt(amount))} ${assetLabel}`);
}
for (const worker of workers.processes()) {
  out(
    `  worker ${worker.agentId.padEnd(8)} pid ${String(worker.pid)} exit ${worker.exit === null ? "running" : `code ${String(worker.exit.code)} signal ${String(worker.exit.signal)}`}`,
  );
}
const shutdown = async () => {
  await stop();
  process.exit(0);
};
if (process.argv.includes("--hold")) {
  out(`API held open on ${api.url} for the web page (pnpm web, then /live); Ctrl-C to stop`);
  process.on("SIGINT", () => void shutdown());
} else {
  await shutdown();
}
