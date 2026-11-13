import { describe, expect, it } from "vitest";
import { asPrincipal, primaryBid, principals, roster } from "@backstop/agents";
import { candidate, checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { near, toYocto } from "@backstop/shared";
import { handle, tick } from "../src/index.js";
import { call, origin, read, signedRequest, testRuntime } from "./support.js";

const taskId = "checkout-api";

async function bondedTask() {
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
  await call(
    runtime,
    clock,
    principals.customer,
    `/api/tasks/${taskId}/funding`,
    fund("escrow", "0.40"),
  );
  await call(
    runtime,
    clock,
    principals.customer,
    `/api/tasks/${taskId}/funding`,
    fund("premium", "0.04"),
  );
  await call(
    runtime,
    clock,
    principals.guarantor,
    `/api/tasks/${taskId}/funding`,
    fund("bond", "0.25"),
  );
  return { runtime, clock };
}

async function primaryAt(lead: typeof roster.gamma) {
  const task = await bondedTask();
  const bid = primaryBid(lead, taskId, "0.30", task.clock.now);
  await call(task.runtime, task.clock, asPrincipal(lead), `/api/tasks/${taskId}/bids`, { bid });
  await call(task.runtime, task.clock, asPrincipal(lead), `/api/tasks/${taskId}/claim`, {});
  return task;
}

describe("the Backstop API", () => {
  it("creates and funds a task only through signed requests from the right principals", async () => {
    const { runtime, clock } = testRuntime();
    const manifest = checkoutManifest({
      taskId,
      createdAtMs: clock.now,
      maxAttempts: 3,
      timing: liveTiming,
    });
    expect(
      (await call(runtime, clock, principals.guarantor, "/api/tasks", { manifest })).status,
    ).toBe(403);
    expect(
      (await call(runtime, clock, principals.customer, "/api/tasks", { manifest })).status,
    ).toBe(201);
    const escrow = { pool: "escrow", amountYocto: toYocto(near("0.40")), liabilityYocto: null };
    expect(
      (await call(runtime, clock, principals.guarantor, `/api/tasks/${taskId}/funding`, escrow))
        .status,
    ).toBe(403);
    expect(
      (await call(runtime, clock, principals.customer, `/api/tasks/${taskId}/funding`, escrow))
        .status,
    ).toBe(200);
    const view = await read(runtime, `/api/tasks/${taskId}`);
    expect(view.body).toMatchObject({
      mode: "fixture",
      statement: { totalIn: toYocto(near("0.40")) },
    });
  });

  it("refuses a tampered body, an unknown actor and a stale request", async () => {
    const { runtime, clock } = await bondedTask();
    const request = signedRequest(
      asPrincipal(roster.alpha),
      `/api/tasks/${taskId}/claim`,
      {},
      { issuedAtMs: clock.now },
    );
    const tampered = JSON.parse(await request.text()) as Record<string, unknown>;
    const forged = new Request(`${origin}/api/tasks/${taskId}/claim`, {
      method: "POST",
      body: JSON.stringify({ ...tampered, body: { extra: true } }),
    });
    expect((await handle(runtime, forged)).status).toBe(401);
    const stranger = { id: "mallory", account: "mallory.testnet", key: roster.alpha.key };
    expect((await call(runtime, clock, stranger, `/api/tasks/${taskId}/claim`, {})).status).toBe(
      403,
    );
    const old = signedRequest(
      asPrincipal(roster.alpha),
      `/api/tasks/${taskId}/claim`,
      {},
      { issuedAtMs: clock.now - 600_000 },
    );
    expect((await handle(runtime, old)).status).toBe(401);
  });

  it("replays a retried request instead of applying it twice", async () => {
    const { runtime, clock } = testRuntime();
    const manifest = checkoutManifest({
      taskId,
      createdAtMs: clock.now,
      maxAttempts: 3,
      timing: liveTiming,
    });
    await call(runtime, clock, principals.customer, "/api/tasks", { manifest });
    const escrow = { pool: "escrow", amountYocto: toYocto(near("0.40")), liabilityYocto: null };
    const first = await call(
      runtime,
      clock,
      principals.customer,
      `/api/tasks/${taskId}/funding`,
      escrow,
      "retry-0001",
    );
    const second = await call(
      runtime,
      clock,
      principals.customer,
      `/api/tasks/${taskId}/funding`,
      escrow,
      "retry-0001",
    );
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body);
    expect((await read(runtime, `/api/tasks/${taskId}`)).body).toMatchObject({
      statement: { totalIn: toYocto(near("0.40")) },
    });
  });

  it("assigns the first valid primary bid and fences a stale heartbeat with a full error envelope", async () => {
    const { runtime, clock } = await primaryAt(roster.alpha);
    const stale = await call(
      runtime,
      clock,
      asPrincipal(roster.alpha),
      `/api/tasks/${taskId}/heartbeat`,
      {
        fencingToken: 2,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: { code: "STALE_LEASE", retryable: false, taskVersion: 6 },
    });
    expect(stale.body).toHaveProperty("error.traceId");
  });

  it("verifies a submission itself, waits out the challenge window, settles once", async () => {
    const { runtime, clock } = await primaryAt(roster.gamma);
    const source = candidate("gamma-integer").source;
    const submitted = await call(
      runtime,
      clock,
      asPrincipal(roster.gamma),
      `/api/tasks/${taskId}/artifacts`,
      {
        fencingToken: 1,
        source,
        checkpointHash: null,
      },
    );
    expect(submitted.status).toBe(201);
    expect((await read(runtime, `/api/tasks/${taskId}`)).body).toMatchObject({
      task: { state: "VERIFYING" },
    });
    clock.now += liveTiming.challengeWindowMs + 1;
    tick(runtime);
    tick(runtime);
    expect((await read(runtime, `/api/tasks/${taskId}`)).body).toMatchObject({
      task: { state: "SETTLED" },
    });
    const again = await call(
      runtime,
      clock,
      principals.coordinator,
      `/api/tasks/${taskId}/settle`,
      {},
    );
    expect(again.body).toMatchObject({ error: { code: "ALREADY_SETTLED" } });
  });

  it("refuses a self-challenge and upholds a counterexample the verifier reproduces", async () => {
    const { runtime, clock } = await primaryAt(roster.beta);
    const source = candidate("beta-boundary").source;
    await call(runtime, clock, asPrincipal(roster.beta), `/api/tasks/${taskId}/artifacts`, {
      fencingToken: 1,
      source,
      checkpointHash: null,
    });
    const input = {
      lines: [{ sku: "coat", unitPriceCents: 10_000, quantity: 1 }],
      discountPercent: 0,
      taxRateBps: 0,
      shippingCents: 999,
      freeShippingThresholdCents: 10_000,
    };
    expect(
      (
        await call(runtime, clock, asPrincipal(roster.beta), `/api/tasks/${taskId}/challenge`, {
          input,
        })
      ).status,
    ).toBe(422);
    const upheld = await call(
      runtime,
      clock,
      asPrincipal(roster.kappa),
      `/api/tasks/${taskId}/challenge`,
      {
        input,
      },
    );
    expect(upheld.status).toBe(200);
    expect((await read(runtime, `/api/tasks/${taskId}`)).body).toMatchObject({
      task: { state: "RECOVERY_OPEN" },
    });
  });

  it("keeps fault injection off outside demo mode", async () => {
    const { runtime, clock } = await bondedTask();
    const fault = await call(runtime, clock, principals.coordinator, "/api/demo/faults", {
      action: "fail_next_transfer",
      taskId,
    });
    expect(fault).toMatchObject({ status: 403, body: { error: { code: "DEMO_DISABLED" } } });
  });

  it("serves the event log as JSON or as a server-sent event stream", async () => {
    const { runtime } = await bondedTask();
    const log = await read(runtime, `/api/tasks/${taskId}/events?after=2`);
    expect(log.body).toMatchObject({ events: [{ version: 3 }, { version: 4 }] });
    const stream = await handle(
      runtime,
      new Request(`${origin}/api/tasks/${taskId}/events`, {
        headers: { accept: "text/event-stream" },
      }),
    );
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const reader = stream.body?.getReader();
    const first = await reader?.read();
    const chunk: unknown = first?.value;
    expect(chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : "").toContain(
      "event: task",
    );
    await reader?.cancel();
    expect(runtime.listeners.size).toBe(0);
  });

  it("answers unknown routes, wrong methods and malformed JSON with the error envelope", async () => {
    const { runtime } = testRuntime();
    expect((await read(runtime, "/api/nope")).status).toBe(404);
    expect((await handle(runtime, new Request(`${origin}/api/tasks`))).status).toBe(405);
    const malformed = new Request(`${origin}/api/tasks`, { method: "POST", body: "{not json" });
    expect((await handle(runtime, malformed)).status).toBe(400);
  });
});
