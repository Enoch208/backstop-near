import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ModelConfig } from "@backstop/agents";
import type { Json } from "@backstop/shared";
import { tsxLoader } from "@backstop/workers";
import { z } from "zod";

export const operatorSpecs = [
  {
    id: "blind-primary",
    price: "0.40",
    secondary: false,
    standby: false,
    style: "Implement the written rules precisely.",
  },
  {
    id: "blind-fixed-first",
    price: "0.44",
    secondary: false,
    standby: false,
    style: "Implement from the specification and use a straightforward reference algorithm.",
  },
  {
    id: "blind-low-bid",
    price: "0.28",
    secondary: false,
    standby: false,
    style: "Make a precise correction from the checkpoint and check boundary cases.",
  },
  {
    id: "blind-standby-first",
    price: "0.58",
    secondary: true,
    standby: true,
    style: "Re-derive the algorithm independently and check counterexamples.",
  },
  {
    id: "blind-standby-low",
    price: "0.52",
    secondary: true,
    standby: true,
    style: "Use the pinned checkpoint and check all invariants before submission.",
  },
] as const;
export type OperatorSpec = (typeof operatorSpecs)[number];

const readySchema = z.object({
  ready: z.literal(true),
  agentId: z.string(),
  host: z.string(),
  model: z.string(),
});
const messageSchema = z.union([
  z.strictObject({ value: z.unknown() }),
  z.strictObject({ error: z.string() }),
]);
const entry = fileURLToPath(new URL("./live-operator.ts", import.meta.url));

export async function startOperator(
  api: string,
  spec: Omit<OperatorSpec, "id"> & { readonly id: string },
  config: ModelConfig,
) {
  const child = fork(entry, [], {
    execArgv: ["--import", tsxLoader],
    env: {
      PATH: process.env.PATH,
      BACKSTOP_AI_BASE_URL: config.baseUrl,
      BACKSTOP_AI_MODEL: config.model,
      BACKSTOP_AI_API_KEY: config.apiKey,
      BENCH_OPERATOR_API: api,
      BENCH_OPERATOR_SEED: randomBytes(32).toString("hex"),
      BENCH_OPERATOR_ID: spec.id,
      BENCH_OPERATOR_PRICE: spec.price,
      BENCH_OPERATOR_STYLE: spec.style,
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  let pending: { resolve: (body: unknown) => void; reject: (error: Error) => void } | null = null;
  let failure: Error | null = null;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      failure = new Error(`${spec.id} exited (${String(code ?? signal)})`);
      pending?.reject(failure);
      pending = null;
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      failure = error;
      pending?.reject(error);
      pending = null;
      resolve({ code: null, signal: null });
    });
  });
  child.on("message", (body) => {
    const reply = pending;
    pending = null;
    reply?.resolve(body);
  });
  const first = await new Promise<unknown>((resolve, reject) => {
    pending = { resolve, reject };
  });
  const ready = readySchema.parse(first);
  const send = async (body: Record<string, Json>): Promise<unknown> => {
    if (failure !== null) throw failure;
    if (pending !== null) throw new Error(`${spec.id} already has an active command`);
    const reply = await new Promise<unknown>((resolve, reject) => {
      pending = { resolve, reject };
      child.send(body, (error) => {
        if (error == null) return;
        pending = null;
        reject(error);
      });
    });
    const parsed = messageSchema.parse(reply);
    if ("error" in parsed) throw new Error(`${spec.id}: ${parsed.error}`);
    return parsed.value;
  };
  return {
    ...spec,
    ...ready,
    pid: child.pid,
    send,
    stop: async (signal: NodeJS.Signals = "SIGTERM") => {
      child.kill(signal);
      return exit;
    },
  };
}

export type Operator = Awaited<ReturnType<typeof startOperator>>;
