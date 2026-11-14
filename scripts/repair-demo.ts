import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import {
  digestOf,
  digestSchema,
  digestText,
  repairRunnerId,
  repairTaskSchema,
  suiteHash,
} from "@backstop/shared";
import type { ApiClient, Reply } from "@backstop/workers";
import { z } from "zod";

export function demoOptions() {
  const { values } = parseArgs({
    options: {
      task: { type: "string" },
      output: { type: "string" },
      "task-id": { type: "string" },
      "external-recovery": { type: "boolean" },
      chain: { type: "string" },
      "token-fixture": { type: "string" },
      "usdc-root": { type: "string" },
      intents: { type: "boolean" },
      capture: { type: "boolean" },
      hold: { type: "boolean" },
      "manual-kill": { type: "boolean" },
    },
  });
  const task =
    values.task === undefined
      ? undefined
      : repairTaskSchema.parse(JSON.parse(readFileSync(values.task, "utf8")));
  if (task === undefined && (values.output !== undefined || values["external-recovery"])) {
    throw new Error("--output and --external-recovery require --task <file.json>");
  }
  if (values["manual-kill"] && task?.primaryMilestone === undefined) {
    throw new Error("--manual-kill requires a task with a primaryMilestone");
  }
  const token = values["token-fixture"] !== undefined || values["usdc-root"] !== undefined;
  if (
    token &&
    (task?.primaryMilestone === undefined ||
      values.intents ||
      values.capture ||
      values["external-recovery"])
  )
    throw new Error("A token demo requires a repair task with a primary milestone");
  if (
    values["token-fixture"] !== undefined &&
    !(values.chain === "sandbox" && values["usdc-root"] === undefined)
  )
    throw new Error("--token-fixture requires --chain sandbox");
  if (
    values["usdc-root"] !== undefined &&
    ((values.chain !== "testnet" && values.chain !== "mainnet") ||
      values["task-id"] === undefined ||
      !/^[a-z\d-]{1,64}$/.test(values["task-id"]))
  ) {
    throw new Error("--usdc-root requires --chain testnet or mainnet and a fresh --task-id");
  }
  return {
    task,
    output: values.output,
    taskId: values["task-id"],
    external: values["external-recovery"] === true,
    manualKill: values["manual-kill"] === true,
    tokenFixture: values["token-fixture"],
    usdcRoot: values["usdc-root"],
  };
}

export async function confirmKill(): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question("Primary checkpoint saved. Press Enter to kill the worker.\n");
  } finally {
    prompt.close();
  }
}

export function demoManifest(
  options: ReturnType<typeof demoOptions>,
  taskId: string,
  createdAtMs: number,
) {
  const base = checkoutManifest({ taskId, createdAtMs, maxAttempts: 3, timing: liveTiming });
  const task = options.task;
  if (task === undefined) return base;
  return {
    ...base,
    objective: task.objective,
    repairTaskHash: digestOf(task),
    suite: {
      suiteId: task.suite.suiteId,
      suiteHash: suiteHash(task.suite),
      runnerId: repairRunnerId,
    },
    policy: { ...base.policy, challengeWindowMs: 8_000 },
  };
}

export async function checked(reply: Promise<Reply>, action: string): Promise<Reply> {
  const result = await reply;
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `${action} failed (HTTP ${String(result.status)}): ${JSON.stringify(result.body)}`,
    );
  }
  return result;
}

const settledCandidate = z.object({
  task: z.object({
    state: z.literal("SETTLED"),
    candidate: z.object({ artifactHash: digestSchema }),
  }),
});

export async function deliver(client: ApiClient, taskId: string, path: string): Promise<string> {
  const base = `/api/tasks/${taskId}`;
  const view = settledCandidate.parse(
    (await checked(client.get(base), "Read the settled task")).body,
  );
  const hash = view.task.candidate.artifactHash;
  const result = await checked(
    client.get(`${base}/artifacts/${hash}`),
    "Read the accepted artifact",
  );
  const { source } = z.object({ source: z.string() }).parse(result.body);
  if (digestText(source) !== hash) throw new Error("The accepted artifact does not match its hash");
  writeFileSync(path, source, { flag: "wx" });
  return hash;
}
