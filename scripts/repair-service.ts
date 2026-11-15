import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { vaultWasmPath } from "@backstop/near";
import { RepairJobs } from "./repair-service/store.js";
import { repairServer } from "./repair-service/server.js";
import { runRepairJob } from "./repair-service/runner.js";
import { lockRepairService } from "./repair-service/lock.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const env = z
  .object({
    BACKSTOP_REPAIR_ACCESS_TOKEN: z.string().min(32),
    BACKSTOP_REPAIR_ORIGIN: z.url().default("http://localhost:5210"),
    BACKSTOP_REPAIR_PORT: z.coerce.number().int().min(1).max(65535).default(8842),
    BACKSTOP_AI_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    BACKSTOP_TESTNET_ACCOUNT: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().endsWith(".testnet").optional(),
    ),
  })
  .parse(process.env);
const unlock = lockRepairService(resolve(".backstop/repair-service.lock"));
process.once("exit", unlock);
const store = new RepairJobs(resolve(".backstop/jobs"));
const stops = new Map<string, () => void>();
const server = repairServer({
  store,
  token: env.BACKSTOP_REPAIR_ACCESS_TOKEN,
  enabled:
    env.BACKSTOP_AI_API_KEY !== undefined &&
    env.BACKSTOP_TESTNET_ACCOUNT !== undefined &&
    existsSync(vaultWasmPath),
  origins: [new URL(env.BACKSTOP_REPAIR_ORIGIN).origin],
  launch: (job) => {
    stops.set(job.id, runRepairJob(store, job, process.env));
  },
});
const stop = () => {
  for (const shutdown of stops.values()) shutdown();
  server.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
server.listen(env.BACKSTOP_REPAIR_PORT, "127.0.0.1", () => {
  process.stdout.write(
    `Repair pilot on http://127.0.0.1:${String(env.BACKSTOP_REPAIR_PORT)} (live AI, team-paid NEAR testnet)\n`,
  );
});
