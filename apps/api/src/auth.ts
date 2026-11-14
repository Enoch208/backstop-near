import { isAuthenticRequest, signedRequestSchema } from "@backstop/shared";
import { errorResponse, failure, json, readJson, type ApiError } from "./http.js";
import type { Identity, Runtime } from "./runtime.js";

export const requestFreshnessMs = 300_000;

export type Authenticated = {
  readonly actor: Identity;
  readonly body: unknown;
  readonly key: string;
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
    value: { actor, body: parsed.data.body, key: `${actor.id}:${parsed.data.requestId}` },
  };
}

export async function signedWrite(
  runtime: Runtime,
  request: Request,
  handle: (auth: Authenticated) => Handled | { error: ApiError; taskVersion: number | null },
): Promise<Response> {
  const traceId = crypto.randomUUID();
  const auth = await authenticate(runtime, request);
  if (!auth.ok) return errorResponse(auth.error, traceId, null);
  const cached = runtime.replies.get(auth.value.key);
  if (cached !== undefined) {
    return new Response(cached.body, {
      status: cached.status,
      headers: { "content-type": "application/json", "idempotent-replay": "true" },
    });
  }
  const result = handle(auth.value);
  const response =
    "error" in result
      ? errorResponse(result.error, traceId, result.taskVersion)
      : json(result.value, result.status);
  runtime.replies.set(auth.value.key, {
    status: response.status,
    body: await response.clone().text(),
  });
  return response;
}
