import { digestOf, isAuthenticRequest, signedRequestSchema, type Digest } from "@backstop/shared";
import { errorBody, errorResponse, failure, readJson, toJson, type ApiError } from "./http.js";
import { atomic, type Identity, type Reply, type Runtime } from "./runtime.js";

export const requestFreshnessMs = 300_000;

export type Authenticated = {
  readonly actor: Identity;
  readonly body: unknown;
  readonly key: string;
  readonly fingerprint: Digest;
};

export type Handled = { readonly status: number; readonly value: unknown };

export async function authenticate(
  runtime: Runtime,
  request: Request,
): Promise<{ ok: true; value: Authenticated } | { ok: false; error: ApiError }> {
  const parsed = signedRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return { ok: false, error: failure("INVALID_SCHEMA", parsed.error.message) };
  const actor = runtime.identities.get(parsed.data.actor);
  if (actor === undefined)
    return { ok: false, error: failure("UNAUTHORIZED", `Unknown actor ${parsed.data.actor}`) };
  const scope = { method: request.method, path: new URL(request.url).pathname };
  if (!isAuthenticRequest(parsed.data, scope, actor.publicKey)) {
    return { ok: false, error: failure("BAD_SIGNATURE", "The request is not signed by its actor") };
  }
  if (Math.abs(runtime.now() - parsed.data.issuedAtMs) > requestFreshnessMs) {
    return {
      ok: false,
      error: failure("BAD_SIGNATURE", "The request is too old or from the future"),
    };
  }
  return {
    ok: true,
    value: {
      actor,
      body: parsed.data.body,
      key: `${actor.id}:${parsed.data.requestId}`,
      fingerprint: digestOf({ ...scope, body: parsed.data.body }),
    },
  };
}

export type HandlerResult = Handled | { error: ApiError; taskVersion: number | null };

const replay = (cached: Reply) =>
  new Response(cached.body, {
    status: cached.status,
    headers: { "content-type": "application/json", "idempotent-replay": "true" },
  });

export function keepReply(
  runtime: Runtime,
  { key, fingerprint }: { key: string; fingerprint: Digest },
  result: HandlerResult,
  traceId: string,
): Reply {
  const status = "error" in result ? result.error.status : result.status;
  const value =
    "error" in result ? errorBody(result.error, traceId, result.taskVersion) : result.value;
  const reply: Reply = { status, body: toJson(value), fingerprint };
  if (runtime.persistence === null) runtime.replies.set(key, reply);
  else runtime.persistence.putReply(key, reply);
  return reply;
}

export async function signedWrite(
  runtime: Runtime,
  request: Request,
  handle: (auth: Authenticated) => HandlerResult | Promise<() => HandlerResult>,
): Promise<Response> {
  const traceId = crypto.randomUUID();
  const auth = await authenticate(runtime, request);
  if (!auth.ok) return errorResponse(auth.error, traceId, null);
  const { key, fingerprint } = auth.value;
  const duplicate = () =>
    errorResponse(
      failure("DUPLICATE", "This request ID belongs to a different operation"),
      traceId,
      null,
    );
  const cached = runtime.persistence?.getReply(key) ?? runtime.replies.get(key);
  if (cached !== undefined)
    return cached.fingerprint === fingerprint ? replay(cached) : duplicate();
  const running = runtime.inflight.get(key);
  if (running !== undefined) {
    return running.fingerprint === fingerprint ? replay(await running.promise) : duplicate();
  }
  const work = Promise.resolve().then(async () => {
    let pending: Promise<() => HandlerResult> | undefined;
    const immediate = atomic(runtime, () => {
      const result = handle(auth.value);
      if (result instanceof Promise) {
        pending = result;
        return undefined;
      }
      return keepReply(runtime, auth.value, result, traceId);
    });
    if (immediate !== undefined) return immediate;
    if (pending === undefined) throw new Error("Signed write produced no result");
    const finalize = await pending;
    return atomic(runtime, () => keepReply(runtime, auth.value, finalize(), traceId));
  });
  runtime.inflight.set(key, { fingerprint, promise: work });
  try {
    const reply = await work;
    return new Response(reply.body, {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  } finally {
    runtime.inflight.delete(key);
  }
}
