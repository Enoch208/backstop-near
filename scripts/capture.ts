import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ApiClient } from "@backstop/workers";
import { z } from "zod";

type Frame = {
  readonly atMs: number;
  readonly event: unknown;
  readonly task: unknown;
  readonly workers: unknown;
  readonly chain: unknown;
};

export type Capture = {
  readonly record: (event: unknown) => void;
  readonly finish: (meta: Record<string, unknown>) => Promise<string>;
};

export function capture(client: ApiClient, taskId: string, startedAt: number): Capture {
  const frames: Frame[] = [];
  const last = { task: "", workers: "", chain: "" };
  let queue = Promise.resolve();
  const changed = (key: keyof typeof last, value: unknown) => {
    const text = JSON.stringify(value);
    if (text === last[key]) return null;
    last[key] = text;
    return value;
  };
  const snapshot = async (event: unknown) => {
    const atMs = Date.now() - startedAt;
    const [task, workers, chain] = await Promise.all([
      client.get(`/api/tasks/${taskId}`),
      client.get("/api/workers"),
      client.get(`/api/tasks/${taskId}/chain`),
    ]);
    frames.push({
      atMs,
      event,
      task: changed("task", task.body),
      workers: changed("workers", workers.body),
      chain: changed("chain", chain.body),
    });
  };
  return {
    record: (event) => {
      queue = queue.then(() => snapshot(event));
    },
    finish: async (meta) => {
      await queue;
      await snapshot(null);
      const directory = new URL("../apps/web/public/runs/", import.meta.url);
      mkdirSync(directory, { recursive: true });
      const path = new URL(`${taskId}.json`, directory);
      writeFileSync(path, `${JSON.stringify({ taskId, ...meta, frames })}\n`);
      const index = new URL("index.json", directory);
      const previous: unknown = existsSync(index) ? JSON.parse(readFileSync(index, "utf8")) : [];
      const parsed = z.array(z.unknown()).safeParse(previous);
      const runs = parsed.success ? parsed.data : [];
      writeFileSync(index, `${JSON.stringify([...runs, { taskId, ...meta }], null, 2)}\n`);
      return path.pathname;
    },
  };
}
