import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

type Phase = "starting" | "armed" | "recovering" | "settled";

const out = (line: string) => process.stdout.write(`${line}\n`);
const controlPort = Number(process.env.BACKSTOP_CONTROL_PORT ?? "8841");
const autoKillMs = 25_000;
const idleRestartMs = 10 * 60_000;
const stuckMs = 150_000;
const cooldownMs = 3_000;
const demo = fileURLToPath(new URL("./demo.ts", import.meta.url));

let child: ChildProcessByStdio<Writable, Readable, null> | null = null;
let phase: Phase = "starting";
let phaseAtMs = Date.now();
let killedBy: "visitor" | "timer" | null = null;
let stopping = false;

function enter(next: Phase): void {
  phase = next;
  phaseAtMs = Date.now();
  out(`[hosted] ${next}`);
}

function start(): void {
  if (stopping) return;
  killedBy = null;
  enter("starting");
  const next = spawn(process.execPath, ["--import", "tsx", demo, "--hold", "--manual-kill"], {
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  child = next;
  createInterface({ input: next.stdout }).on("line", (line) => {
    out(line);
    if (child !== next) return;
    if (line.includes("Press Enter to kill")) enter("armed");
    if (line.startsWith("Final state:")) enter("settled");
  });
  next.once("exit", () => {
    if (child !== next) return;
    child = null;
    setTimeout(start, 2_000);
  });
}

function kill(by: "visitor" | "timer"): boolean {
  if (phase !== "armed" || child === null) return false;
  killedBy = by;
  enter("recovering");
  out(`[hosted] alpha killed by the ${by}`);
  child.stdin.write("\n");
  return true;
}

function replace(signal: NodeJS.Signals): void {
  const current = child;
  child = null;
  enter("starting");
  if (current === null) {
    start();
    return;
  }
  current.once("exit", start);
  current.kill(signal);
}

function restart(): boolean {
  if (phase !== "settled" || Date.now() - phaseAtMs < cooldownMs) return false;
  replace("SIGTERM");
  return true;
}

function status() {
  const age = Date.now() - phaseAtMs;
  return {
    phase,
    canKill: phase === "armed" && child !== null,
    canStart: phase === "settled" && age >= cooldownMs,
    autoKillInMs: phase === "armed" ? Math.max(0, autoKillMs - age) : null,
    killedBy,
  };
}

function reply(response: ServerResponse, code: number): void {
  response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(status()));
}

const server = createServer((request, response) => {
  request.resume();
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/api/demo/control") reply(response, 200);
  else if (request.method === "POST" && path === "/api/demo/kill")
    reply(response, kill("visitor") ? 200 : 409);
  else if (request.method === "POST" && path === "/api/demo/start")
    reply(response, restart() ? 202 : 409);
  else reply(response, 404);
});

const watchdog = setInterval(() => {
  const age = Date.now() - phaseAtMs;
  if (phase === "armed" && age > autoKillMs) kill("timer");
  else if (phase === "settled" && age > idleRestartMs) restart();
  else if ((phase === "starting" || phase === "recovering") && age > stuckMs && child !== null)
    replace("SIGKILL");
}, 500);

function shutdown(): void {
  stopping = true;
  clearInterval(watchdog);
  server.close();
  child?.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.listen(controlPort, "127.0.0.1", () => {
  out(`[hosted] control on http://127.0.0.1:${String(controlPort)}`);
  start();
});
