import { existsSync } from "node:fs";
import { modelFromEnv, principals } from "@backstop/agents";
import { createRuntime, startApi, supervise } from "@backstop/api";
import { checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { formatNear, near, toYocto } from "@backstop/shared";
import { apiClient } from "@backstop/workers";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");
const model = modelFromEnv(process.env);
const out = (line: string) => process.stdout.write(`${line}\n`);
const startedAt = Date.now();
const stamp = () => `+${((Date.now() - startedAt) / 1_000).toFixed(1).padStart(5, " ")}s`;

const runtime = createRuntime(Date.now, true);
const api = await startApi(runtime, "127.0.0.1", Number(process.env.PORT ?? "8840"));
runtime.workers = supervise(runtime, api.url, (line) => out(`${stamp()}   ${line}`));

const customer = apiClient(api.url, principals.customer);
const guarantor = apiClient(api.url, principals.guarantor);
const coordinator = apiClient(api.url, principals.coordinator);
const taskId = `checkout-live-${String(startedAt % 100_000)}`;

out(`Backstop live demo: ${taskId} on ${api.url}`);
out(
  model === null
    ? "Mode: FIXTURE vault (no NEAR moves) and scripted patches; real HTTP, real signed requests,"
    : `Mode: FIXTURE vault (no NEAR moves) and LIVE AI patches from ${model.model}; real HTTP, signed requests,`,
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
const settled = new Promise<string>((resolve) => {
  void customer.follow(taskId, (raw) => {
    const event = eventSchema.parse(raw);
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
});

const kind = await settled;
const again = await coordinator.post("/api/demo/faults", { action: "repeat_settlement", taskId });
out(`${stamp()}     judge: settle again -> HTTP ${String(again.status)}`);

const workers = runtime.workers;
for (
  let waited = 0;
  waited < 3_000 && workers.processes().some((worker) => worker.exit === null);
  waited += 100
) {
  await new Promise((resolve) => setTimeout(resolve, 100));
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
await api.close();
process.exit(0);
