import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export const workerEntry = fileURLToPath(new URL("./main.ts", import.meta.url));
export const tsxLoader = import.meta.resolve("tsx");

export type WorkerExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

export function spawnWorker(agentId: string, apiUrl: string, taskId: string): ChildProcess {
  return spawn(
    process.execPath,
    ["--import", tsxLoader, workerEntry, "--agent", agentId, "--api", apiUrl, "--task", taskId],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}
