import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { testnetProofProvider } from "@backstop/near";
import { z } from "zod";
import { lockRepairService } from "./repair-service/lock.js";
import { reconcileFailure } from "./repair-service/reconcile.js";
import { RepairJobs } from "./repair-service/store.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const { values } = parseArgs({ options: { job: { type: "string" } } });
const id = z
  .string()
  .regex(/^repair-[a-f0-9-]{36}$/)
  .parse(values.job);
const unlock = lockRepairService(resolve(".backstop/repair-service.lock"));
try {
  const store = new RepairJobs(resolve(".backstop/jobs"));
  const job = store.jobs.get(id);
  if (job === undefined) throw new Error("Unknown repair job");
  const path = await reconcileFailure(
    store,
    job,
    testnetProofProvider(process.env.BACKSTOP_TESTNET_RPC),
  );
  process.stdout.write(`Read-only failure settlement verified for ${id}. Proof: ${path}\n`);
} finally {
  unlock();
}
