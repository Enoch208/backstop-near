import { existsSync } from "node:fs";
import { modelFromEnv } from "@backstop/agents";
import { z } from "zod";
import { createRuntime } from "./runtime.js";
import { startApi } from "./server.js";
import { supervise } from "./supervisor.js";
import { trustAttestedModel } from "./tee.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = z
  .object({
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8840),
    BACKSTOP_DEMO: z.enum(["0", "1"]).default("0"),
  })
  .parse(process.env);

const runtime = createRuntime(Date.now, env.BACKSTOP_DEMO === "1");
const model = modelFromEnv(process.env);
if (model !== null)
  await trustAttestedModel(runtime, model.model, (line) => process.stdout.write(`${line}\n`));
const api = await startApi(runtime, env.HOST, env.PORT);
if (runtime.demo) {
  runtime.workers = supervise(runtime, api.url, (line) => process.stdout.write(`${line}\n`));
}
process.stdout.write(
  `Backstop API (${runtime.mode} mode${runtime.demo ? ", demo faults on" : ""}) on ${api.url}\n`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void api.close().then(() => process.exit(0));
  });
}
