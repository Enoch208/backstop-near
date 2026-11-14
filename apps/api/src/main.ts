import { existsSync } from "node:fs";
import { hexSchema, terminalStates } from "@backstop/shared";
import { connectTestnetVault, defaultTestnetRpc } from "@backstop/near";
import { chainBridge } from "./chain.js";
import { modelFromEnv, principals, roster } from "@backstop/agents";
import { z } from "zod";
import { atomic, createRuntime } from "./runtime.js";
import { startApi } from "./server.js";
import { supervise } from "./supervisor.js";
import { trustAttestedModel } from "./tee.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = z
  .object({
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8840),
    BACKSTOP_API_VAULT: z.enum(["fixture", "testnet"]).default("fixture"),
    BACKSTOP_TESTNET_ACCOUNT: z.string().optional(),
    BACKSTOP_TESTNET_RPC: z.string().min(1).default(defaultTestnetRpc),
    BACKSTOP_STATE_PATH: z.string().min(1).default(".backstop/state.sqlite"),
    BACKSTOP_DEMO: z.enum(["0", "1"]).default("0"),
    BACKSTOP_AGENT_FAILURE_DOMAINS: z.string().optional(),
  })
  .parse(process.env);

if (!["127.0.0.1", "localhost"].includes(env.HOST)) {
  throw new Error(
    "The prototype API must bind to loopback. Use a private tunnel for outside workers.",
  );
}

const agentFailureDomains =
  env.BACKSTOP_AGENT_FAILURE_DOMAINS === undefined
    ? undefined
    : z
        .record(z.string().min(1), z.string().trim().min(1).max(256))
        .parse(JSON.parse(env.BACKSTOP_AGENT_FAILURE_DOMAINS));
const runtime = createRuntime(
  Date.now,
  env.BACKSTOP_DEMO === "1",
  env.BACKSTOP_STATE_PATH,
  agentFailureDomains,
);
if (env.BACKSTOP_API_VAULT === "testnet") {
  const keys = z
    .object({
      BACKSTOP_CUSTOMER_PUBLIC_KEY: hexSchema.length(64),
      BACKSTOP_GUARANTOR_PUBLIC_KEY: hexSchema.length(64),
      BACKSTOP_COORDINATOR_PUBLIC_KEY: hexSchema.length(64),
    })
    .parse(process.env);
  const provided = [
    [principals.customer, keys.BACKSTOP_CUSTOMER_PUBLIC_KEY],
    [principals.guarantor, keys.BACKSTOP_GUARANTOR_PUBLIC_KEY],
    [principals.coordinator, keys.BACKSTOP_COORDINATOR_PUBLIC_KEY],
  ] as const;
  const fixtureKeys = new Set([
    ...Object.values(principals).map(({ key }) => key.publicKey),
    ...Object.values(roster).map(({ key }) => key.publicKey),
  ]);
  if (
    new Set(provided.map(([, key]) => key)).size !== provided.length ||
    provided.some(([, key]) => fixtureKeys.has(key))
  ) {
    throw new Error(
      "The NEAR API requires a different private signer for each funding and coordinator role",
    );
  }
  if (env.BACKSTOP_TESTNET_ACCOUNT === undefined || env.BACKSTOP_TESTNET_ACCOUNT === "")
    throw new Error("Set BACKSTOP_TESTNET_ACCOUNT to the root of the deployed vault");
  const parties = await connectTestnetVault(env.BACKSTOP_TESTNET_ACCOUNT, env.BACKSTOP_TESTNET_RPC);
  atomic(runtime, () => {
    for (const [{ id, account }, publicKey] of provided) {
      runtime.identities.set(id, { id, account, publicKey });
    }
    runtime.registry = {
      ...runtime.registry,
      agentKeys: Object.fromEntries(
        [...runtime.identities].map(([id, identity]) => [id, identity.publicKey]),
      ),
    };
  });
  runtime.chain = chainBridge("testnet", parties, ({ step, diverged }) => {
    process.stdout.write(
      `[near] ${step.label}: ${step.call.txHash}${diverged ? " refused" : ""}\n`,
    );
  });
}
const model = modelFromEnv(process.env);
if (model !== null)
  await trustAttestedModel(runtime, model.model, (line) => process.stdout.write(`${line}\n`));
const api = await startApi(runtime, env.HOST, env.PORT);
if (runtime.demo) {
  runtime.workers = supervise(runtime, api.url, (line) => process.stdout.write(`${line}\n`));
  for (const record of Object.values(runtime.store.records)) {
    if (terminalStates.every((state) => state !== record.state))
      runtime.workers.launch(record.taskId);
  }
}
process.stdout.write(
  `Backstop API (${runtime.mode} mode${runtime.demo ? ", demo faults on" : ""}) on ${api.url}\n`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void api.close().then(() => process.exit(0));
  });
}
