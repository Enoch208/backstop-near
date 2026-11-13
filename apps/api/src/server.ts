import { createServer, type Server } from "node:http";
import { tick } from "./automations.js";
import { sendWeb, toWebRequest } from "./node-bridge.js";
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
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    toWebRequest(req, url)
      .then((request) => handle(runtime, request))
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
  const keeper = setInterval(() => {
    tick(runtime);
  }, tickMs);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The API is not on a TCP port");
  return {
    url: `http://${host}:${String(address.port)}`,
    server,
    close: async () => {
      clearInterval(keeper);
      runtime.workers?.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
