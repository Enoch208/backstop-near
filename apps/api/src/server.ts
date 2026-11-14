import { createServer, type Server } from "node:http";
import { z } from "zod";
import { tick } from "./automations.js";
import { sendWeb, toWebRequest } from "./node-bridge.js";
import { recoverFunding } from "./routes/deposits.js";
import { handle } from "./router.js";
import type { Runtime } from "./runtime.js";

export type ApiServer = {
  readonly url: string;
  readonly server: Server;
  readonly close: () => Promise<void>;
};

export async function startApi(
  runtime: Runtime,
  host: string,
  port: number,
  tickMs = 200,
): Promise<ApiServer> {
  const mode =
    runtime.chain === null
      ? "fixture"
      : `${runtime.chain.network}:${runtime.chain.parties.vault.contractId}`;
  const bound = runtime.persistence?.get("ledger-mode", z.string());
  if (bound !== undefined && bound !== mode)
    throw new Error(`Coordinator database belongs to ${bound}; it cannot serve ${mode}`);
  runtime.persistence?.set("ledger-mode", mode);
  await recoverFunding(runtime);
  let closing = false;
  const server = createServer((req, res) => {
    if (closing) {
      res.statusCode = 503;
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    toWebRequest(req, url)
      .then((request) => (closing ? new Response(null, { status: 503 }) : handle(runtime, request)))
      .then((response) => sendWeb(res, response))
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: { code: "INTERNAL", message: "The server could not complete the request." },
            }),
          );
        } else {
          res.destroy();
        }
      });
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  let recovery: Promise<void> | null = null;
  let nextFundingCheckAt = runtime.now() + 2_000;
  const keeper = setInterval(() => {
    tick(runtime);
    if (
      runtime.pendingFunding.size === 0 ||
      recovery !== null ||
      runtime.now() < nextFundingCheckAt
    )
      return;
    recovery = recoverFunding(runtime)
      .catch((error: unknown) => {
        process.stderr.write(
          `NEAR funding reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      })
      .finally(() => {
        nextFundingCheckAt = runtime.now() + 2_000;
        recovery = null;
      });
  }, tickMs);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The API is not on a TCP port");
  return {
    url: `http://${host}:${String(address.port)}`,
    server,
    close: async () => {
      closing = true;
      clearInterval(keeper);
      runtime.workers?.stop();
      await Promise.allSettled([...runtime.inflight.values()].map(({ promise }) => promise));
      if (recovery !== null) await recovery;
      if (runtime.chain !== null) {
        runtime.chain.stopping = true;
        await Promise.all(runtime.chain.queues.values());
      }
      runtime.persistence?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
