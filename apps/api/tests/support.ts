import { principals, type Principal } from "@backstop/agents";
import { checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { near, signRequest, toYocto, type Json } from "@backstop/shared";
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

export async function bondedTask(taskId: string): Promise<{ runtime: Runtime; clock: Clock }> {
  const { runtime, clock } = testRuntime();
  const manifest = checkoutManifest({
    taskId,
    createdAtMs: clock.now,
    maxAttempts: 3,
    timing: liveTiming,
  });
  await call(runtime, clock, principals.customer, "/api/tasks", { manifest });
  const fund = (pool: string, amount: string) => ({
    pool,
    amountYocto: toYocto(near(amount)),
    liabilityYocto: null,
  });
  const path = `/api/tasks/${taskId}/funding`;
  await call(runtime, clock, principals.customer, path, fund("escrow", "0.40"));
  await call(runtime, clock, principals.customer, path, fund("premium", "0.04"));
  await call(runtime, clock, principals.guarantor, path, fund("bond", "0.25"));
  return { runtime, clock };
}
