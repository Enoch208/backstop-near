import { errorResponse, type ApiError } from "./http.js";
import { listTasks, register } from "./routes/agents.js";
import { fault } from "./routes/demo.js";
import { getFinding, postFinding } from "./routes/findings.js";
import { bid, createTask, endorse, fund } from "./routes/funding.js";
import {
  chainSteps,
  events,
  getArtifact,
  getTask,
  health,
  payouts,
  workers,
} from "./routes/read.js";
import { challenge, settle } from "./routes/verdicts.js";
import { checkpoint, claim, heartbeat, submitArtifact } from "./routes/work.js";
import type { Runtime } from "./runtime.js";

type Handler = (
  runtime: Runtime,
  request: Request,
  params: readonly string[],
) => Response | Promise<Response>;

type Route = {
  readonly method: string;
  readonly pattern: readonly string[];
  readonly handle: Handler;
};

const route = (method: string, path: string, handle: Handler): Route => ({
  method,
  pattern: path.split("/").filter(Boolean),
  handle,
});

const first = (params: readonly string[]) => params[0] ?? "";
const second = (params: readonly string[]) => params[1] ?? "";

const routes: readonly Route[] = [
  route("GET", "/api/health", (runtime) => health(runtime)),
  route("GET", "/api/workers", (runtime) => workers(runtime)),
  route("POST", "/api/agents", (runtime, request) => register(runtime, request)),
  route("GET", "/api/tasks", (runtime) => listTasks(runtime)),
  route("POST", "/api/tasks", (runtime, request) => createTask(runtime, request)),
  route("GET", "/api/tasks/:task", (runtime, _request, params) => getTask(runtime, first(params))),
  route("GET", "/api/tasks/:task/payouts", (runtime, _request, params) =>
    payouts(runtime, first(params)),
  ),
  route("GET", "/api/tasks/:task/chain", (runtime, _request, params) =>
    chainSteps(runtime, first(params)),
  ),
  route("GET", "/api/tasks/:task/events", (runtime, request, params) =>
    events(runtime, request, first(params)),
  ),
  route("GET", "/api/tasks/:task/artifacts/:hash", (runtime, _request, params) =>
    getArtifact(runtime, second(params)),
  ),
  route("GET", "/api/tasks/:task/findings/:hash", (runtime, _request, params) =>
    getFinding(runtime, second(params)),
  ),
  route("POST", "/api/tasks/:task/findings", (runtime, request, params) =>
    postFinding(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/funding", (runtime, request, params) =>
    fund(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/bids", (runtime, request, params) =>
    bid(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/endorsements", (runtime, request, params) =>
    endorse(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/claim", (runtime, request, params) =>
    claim(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/heartbeat", (runtime, request, params) =>
    heartbeat(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/checkpoints", (runtime, request, params) =>
    checkpoint(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/artifacts", (runtime, request, params) =>
    submitArtifact(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/challenge", (runtime, request, params) =>
    challenge(runtime, request, first(params)),
  ),
  route("POST", "/api/tasks/:task/settle", (runtime, request, params) =>
    settle(runtime, request, first(params)),
  ),
  route("POST", "/api/demo/faults", (runtime, request) => fault(runtime, request)),
];

function match(pattern: readonly string[], segments: readonly string[]): string[] | null {
  if (pattern.length !== segments.length) return null;
  const params: string[] = [];
  for (const [index, part] of pattern.entries()) {
    const segment = segments[index] ?? "";
    if (part.startsWith(":")) params.push(decodeURIComponent(segment));
    else if (part !== segment) return null;
  }
  return params;
}

const routeError = (code: ApiError["code"], status: number, message: string) =>
  errorResponse({ code, status, message, retryable: false }, crypto.randomUUID(), null);

export async function handle(runtime: Runtime, request: Request): Promise<Response> {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const matching = routes.flatMap((entry) => {
    const params = match(entry.pattern, segments);
    return params === null ? [] : [{ entry, params }];
  });
  if (matching.length === 0) return routeError("ROUTE_NOT_FOUND", 404, "No such route");
  const chosen = matching.find(({ entry }) => entry.method === request.method);
  if (chosen === undefined)
    return routeError("METHOD_NOT_ALLOWED", 405, `${request.method} is not allowed here`);
  try {
    return await chosen.entry.handle(runtime, request, chosen.params);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) {
      return routeError("INVALID_SCHEMA", 400, error.message);
    }
    throw error;
  }
}
