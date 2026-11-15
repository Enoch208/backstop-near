import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { invalidRepairTask } from "@backstop/api";
import { maxBodyBytes, serviceConfig, submissionSchema, type RepairJob } from "./schema.js";
import { JobConflict, type RepairJobs } from "./store.js";

type Options = {
  token: string;
  enabled: boolean;
  origins: readonly string[];
  store: RepairJobs;
  launch: (job: RepairJob) => void;
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function fail(response: ServerResponse, status: number, code: string, message: string): void {
  json(response, status, { error: { code, message } });
}

async function body(request: IncomingMessage): Promise<unknown> {
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    request.on("data", (chunk: unknown) => {
      if (refused) return;
      if (!Buffer.isBuffer(chunk)) {
        refused = true;
        reject(new Error("Invalid request stream"));
        return;
      }
      size += chunk.length;
      if (size > maxBodyBytes) {
        refused = true;
        chunks.length = 0;
        reject(new RangeError("Request exceeds 210 KB"));
      } else chunks.push(chunk);
    });
    request.once("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.once("error", reject);
    request.once("aborted", () => {
      reject(new Error("Request interrupted"));
    });
  });
  return JSON.parse(raw);
}

export function repairServer(options: Options) {
  const tokenHash = createHash("sha256").update(options.token).digest();
  const authorized = (header: string | undefined) => {
    if (options.token.length < 32 || header?.startsWith("Bearer ") !== true) return false;
    return timingSafeEqual(tokenHash, createHash("sha256").update(header.slice(7)).digest());
  };
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const origin = request.headers.origin;
    if (origin !== undefined && !options.origins.includes(origin)) {
      fail(response, 403, "ORIGIN_REFUSED", "This browser origin is not allowed");
      return;
    }
    if (origin !== undefined) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
    }
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "OPTIONS" && path.startsWith("/api/repair-jobs")) {
      response.writeHead(204, {
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "Authorization, Content-Type",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && path === "/api/repair-jobs/config") {
      json(response, 200, serviceConfig(options.enabled));
      return;
    }
    if (!authorized(request.headers.authorization)) {
      request.resume();
      fail(response, 401, "ACCESS_REQUIRED", "A valid pilot access code is required");
      return;
    }
    if (path === "/api/repair-jobs" && request.method === "GET") {
      json(response, 200, { jobs: [...options.store.jobs.values()].slice(-50).reverse() });
      return;
    }
    if (path === "/api/repair-jobs" && request.method === "POST") {
      if (!options.enabled) {
        request.resume();
        fail(response, 503, "NOT_READY", "Live AI and testnet funding are not configured");
        return;
      }
      if (!request.headers["content-type"]?.startsWith("application/json")) {
        request.resume();
        fail(response, 415, "JSON_REQUIRED", "Send an application/json task bundle");
        return;
      }
      const submission = submissionSchema.parse(await body(request));
      const invalid = invalidRepairTask(submission.repairTask);
      if (invalid !== null) {
        fail(response, 400, "INVALID_ORACLE", invalid);
        return;
      }
      const result = options.store.create(submission);
      if (result.created) options.launch(result.job);
      json(response, result.created ? 202 : 200, { job: result.job });
      return;
    }
    const match = /^\/api\/repair-jobs\/(repair-[a-f0-9-]{36})(\/artifact)?$/.exec(path);
    const id = match?.[1];
    const job = id === undefined ? undefined : options.store.jobs.get(id);
    if (request.method === "GET" && job !== undefined) {
      if (match?.[2] === undefined) json(response, 200, { job });
      else {
        const source = options.store.artifact(job);
        if (source === null)
          fail(response, 409, "ARTIFACT_UNAVAILABLE", "No verified settled artifact is available");
        else {
          response.writeHead(200, {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": `attachment; filename="${job.id}.js"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          });
          response.end(source);
        }
      }
      return;
    }
    fail(response, 404, "NOT_FOUND", "Job or endpoint not found");
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof JobConflict) fail(response, 409, "JOB_CONFLICT", error.message);
      else if (error instanceof RangeError) fail(response, 413, "BODY_LIMIT", error.message);
      else if (error instanceof z.ZodError || error instanceof SyntaxError)
        fail(response, 400, "INVALID_TASK", "Task bundle failed validation");
      else {
        process.stderr.write(
          `Repair gateway request failed: ${error instanceof Error ? error.name : "unknown error"}\n`,
        );
        fail(
          response,
          500,
          "SERVICE_ERROR",
          "The task could not be processed; check the operator log",
        );
      }
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
