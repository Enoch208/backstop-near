import type { Principal } from "@backstop/agents";
import { signRequest, type Json } from "@backstop/shared";
import { z } from "zod";
import { createRuntime, handle, type Runtime } from "../src/index.js";

export const origin = "http://backstop.test";

const objectSchema = z.record(z.string(), z.unknown());

export type Clock = { now: number };

export function testRuntime(demo = false): { runtime: Runtime; clock: Clock } {
  const clock: Clock = { now: 1_800_000_000_000 };
  return { runtime: createRuntime(() => clock.now, demo), clock };
}

export function signedRequest(
  identity: Principal,
  path: string,
  body: Json,
  options: { requestId?: string; issuedAtMs: number },
): Request {
  const envelope = signRequest(
    {
      actor: identity.id,
      requestId: options.requestId ?? crypto.randomUUID(),
      issuedAtMs: options.issuedAtMs,
      body,
    },
    { method: "POST", path },
    identity.key,
  );
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
}

export async function call(
  runtime: Runtime,
  clock: Clock,
  identity: Principal,
  path: string,
  body: Json,
  requestId?: string,
): Promise<{ status: number; body: Record<string, unknown>; replayed: boolean }> {
  const request = signedRequest(identity, path, body, {
    issuedAtMs: clock.now,
    ...(requestId === undefined ? {} : { requestId }),
  });
  const response = await handle(runtime, request);
  return {
    status: response.status,
    body: objectSchema.parse(await response.json()),
    replayed: response.headers.get("idempotent-replay") === "true",
  };
}

export async function read(
  runtime: Runtime,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handle(runtime, new Request(`${origin}${path}`));
  return { status: response.status, body: objectSchema.parse(await response.json()) };
}
