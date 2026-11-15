import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { RepairJob } from "./schema.js";
import type { RepairJobs } from "./store.js";

export function runRepairJob(
  store: RepairJobs,
  job: RepairJob,
  env: NodeJS.ProcessEnv,
): () => void {
  const secretValues = Object.entries(env)
    .filter(
      ([name, value]) => /KEY|TOKEN|SECRET/.test(name) && value !== undefined && value.length >= 8,
    )
    .flatMap(([, value]) => (value === undefined ? [] : [value]));
  const scrub = (value: string) =>
    secretValues
      .reduce((line, secret) => line.replaceAll(secret, "[redacted]"), value)
      .replace(/ed25519:[A-Za-z0-9]+/g, "[redacted]")
      .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g, "[internal coordinator]");
  let child: ChildProcess;
  const childEnv: NodeJS.ProcessEnv = { ...env, PORT: "0" };
  childEnv.BACKSTOP_REPAIR_ACCESS_TOKEN = "";
  try {
    child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../demo.ts", import.meta.url)),
        "--chain",
        "testnet",
        "--task",
        store.path(job.id, "task.json"),
        "--task-id",
        job.id,
        "--fault",
        job.fault,
        "--report",
        store.path(job.id, "report.json"),
        "--output",
        store.path(job.id, "artifact.js"),
        "--capture",
        "--capture-directory",
        store.path(job.id, "capture"),
        "--record-path",
        store.path(job.id, "chain.json"),
      ],
      { env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    store.interrupt(job, scrub(error instanceof Error ? error.message : String(error)));
    return () => undefined;
  }
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue;
    createInterface({ input: stream }).on("line", (line: string) => {
      store.log(job, scrub(line));
    });
  }
  const stop = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        store.log(job, "Could not stop the worker group; the operator must inspect its processes.");
      }
    }
  };
  const watchdog = setTimeout(() => {
    store.interrupt(job, "The 15-minute execution deadline elapsed.");
    stop();
  }, 15 * 60_000);
  child.once("exit", stop);
  child.once("error", (error) => {
    clearTimeout(watchdog);
    stop();
    store.interrupt(job, scrub(error.message));
  });
  child.once("close", (code, signal) => {
    clearTimeout(watchdog);
    stop();
    if (job.status === "interrupted") return;
    if (code !== 0) {
      store.interrupt(job, `Worker exited ${signal ?? String(code)}.`);
      return;
    }
    try {
      store.finish(job);
    } catch (error) {
      store.interrupt(job, scrub(error instanceof Error ? error.message : String(error)));
    }
  });
  return () => {
    clearTimeout(watchdog);
    if (job.status === "running") {
      store.interrupt(job, "The repair gateway stopped.");
      stop();
    }
  };
}
