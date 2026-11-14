import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import { spawnWorker } from "@backstop/workers";
import type { Runtime, WorkerControl, WorkerProcess } from "./runtime.js";

export const swarm = ["alpha", "beta", "gamma", "delta", "epsilon", "kappa"] as const;

type Tracked = { child: ChildProcess; record: WorkerProcess };

export function supervise(
  runtime: Runtime,
  apiUrl: string,
  onLine: (line: string) => void,
  names: readonly (typeof swarm)[number][] = swarm,
): WorkerControl {
  const tracked = new Map<string, Tracked>();
  const keyOf = (taskId: string, agentId: string) => `${taskId}/${agentId}`;
  const remember = (taskId: string, agentId: string, line: string) => {
    const lines = runtime.agentLog.get(taskId) ?? [];
    const text = line.replace(/^\[[a-z]+ pid \d+\] /, "");
    runtime.agentLog.set(
      taskId,
      [...lines, { atMs: runtime.now(), agentId, line: text }].slice(-500),
    );
  };

  const launchOne = (taskId: string, agentId: string) => {
    const child = spawnWorker(agentId, apiUrl, taskId);
    const entry: Tracked = {
      child,
      record: {
        taskId,
        agentId,
        pid: child.pid ?? null,
        startedAtMs: runtime.now(),
        exitedAtMs: null,
        exit: null,
      },
    };
    tracked.set(keyOf(taskId, agentId), entry);
    for (const stream of [child.stdout, child.stderr]) {
      if (stream !== null)
        createInterface({ input: stream }).on("line", (line) => {
          remember(taskId, agentId, line);
          onLine(line);
        });
    }
    child.on("exit", (code, signal) => {
      entry.record = { ...entry.record, exitedAtMs: runtime.now(), exit: { code, signal } };
      onLine(
        `[supervisor] ${agentId} pid ${String(entry.record.pid)} exited (code ${String(code)}, signal ${String(signal)})`,
      );
    });
  };

  return {
    launch: (taskId) => {
      for (const agentId of names) launchOne(taskId, agentId);
    },
    kill: (taskId, agentId) => {
      const entry = tracked.get(keyOf(taskId, agentId));
      if (entry === undefined || entry.record.exit !== null) return false;
      return entry.child.kill("SIGKILL");
    },
    processes: () => [...tracked.values()].map((entry) => entry.record),
    stop: () => {
      for (const entry of tracked.values()) {
        if (entry.record.exit === null) entry.child.kill("SIGTERM");
      }
    },
  };
}
