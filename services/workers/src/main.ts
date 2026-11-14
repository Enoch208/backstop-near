import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { asPrincipal, modelFromEnv, roster, type RosterName } from "@backstop/agents";
import { near, recoveryStrategies } from "@backstop/shared";
import { z } from "zod";
import { agentLoop } from "./agent-loop.js";
import { apiClient } from "./client.js";
import { externalWorker, registerWorker } from "./external.js";

const { values } = parseArgs({
  options: {
    agent: { type: "string" },
    api: { type: "string" },
    task: { type: "string" },
    account: { type: "string" },
    "standby-price": { type: "string" },
    "standby-ms": { type: "string" },
    "recovery-strategy": { type: "string" },
  },
});
if (values.account !== undefined && existsSync(".env")) process.loadEnvFile(".env");
const name = values.agent ?? "";
const api = (values.api ?? "").replace(/\/+$/, "");
const taskId = values.task ?? "";

function isRosterName(value: string): value is RosterName {
  return Object.hasOwn(roster, value);
}

if (name === "" || api === "" || taskId === "") {
  process.stderr.write(
    "usage: worker --agent <name> --api <url> --task <id> [--account <payout-account>] [--standby-price <amount>]\n",
  );
  process.exit(2);
}

const standbyPrice = values["standby-price"];
const strategy = z.enum(recoveryStrategies).optional().parse(values["recovery-strategy"]);
const standby =
  standbyPrice === undefined
    ? undefined
    : {
        amount: near(standbyPrice),
        durationMs: Number(values["standby-ms"] ?? "45000"),
        ...(strategy === undefined ? {} : { strategy }),
      };
const outside =
  values.account === undefined ? null : externalWorker(name, values.account, standby?.amount);
const agent = outside?.agent ?? (isRosterName(name) ? roster[name] : null);
if (agent === null || (outside !== null && isRosterName(name)))
  throw new Error(
    "Use a roster name for fixture mode or a unique name and --account for an outside worker",
  );
const log = (line: string) =>
  process.stdout.write(`[${agent.agentId} pid ${String(process.pid)}] ${line}\n`);
const client = apiClient(api, asPrincipal(agent));
const model = modelFromEnv(process.env);
if (
  standby !== undefined &&
  (outside === null ||
    standby.amount <= 0n ||
    !Number.isSafeInteger(standby.durationMs) ||
    standby.durationMs <= 0)
)
  throw new Error(
    "Standby needs an outside worker, positive --standby-price and positive --standby-ms",
  );
if (standby === undefined && values["standby-ms"] !== undefined)
  throw new Error("--standby-ms requires --standby-price");
if (outside !== null) {
  if (model === null) throw new Error("An outside repairer needs BACKSTOP_AI_API_KEY");
  await registerWorker(api, agent);
}
const onEvent = agentLoop(
  agent,
  client,
  taskId,
  log,
  () => {
    log("task settled; exiting");
    process.exit(0);
  },
  model,
  outside?.profile,
  process.env.BACKSTOP_WORKER_CURRENCY,
  standby,
  strategy,
);

log(`started for ${taskId}${model === null ? "" : ` with live AI (${model.model})`}`);
const follow = async () => {
  if (outside === null) return client.follow(taskId, onEvent);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await client.get(`/api/tasks/${taskId}`);
    if (response.status === 200) return client.follow(taskId, onEvent);
    if (response.status !== 404)
      throw new Error(`Task lookup failed (HTTP ${String(response.status)})`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Task ${taskId} did not appear within two minutes`);
};
follow().then(
  () => {
    log("event stream closed");
    process.exit(0);
  },
  (error: unknown) => {
    log(`event stream failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
