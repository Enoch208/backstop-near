import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asPrincipal, primaryBid, principals, roster } from "@backstop/agents";
import { checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { near, toYocto } from "@backstop/shared";
import { describe, expect, it } from "vitest";
import { createRuntime, handle, type Runtime } from "../src/index.js";
import { call, origin, type Clock } from "./support.js";

async function claimTask(runtime: Runtime, clock: Clock, taskId: string) {
  const manifest = checkoutManifest({
    taskId,
    createdAtMs: clock.now,
    timing: liveTiming,
    maxAttempts: 3,
  });
  expect((await call(runtime, clock, principals.customer, "/api/tasks", { manifest })).status).toBe(
    201,
  );
  for (const [pool, amount] of [
    ["escrow", "0.40"],
    ["premium", "0.04"],
    ["bond", "0.25"],
  ] as const) {
    expect(
      (
        await call(
          runtime,
          clock,
          pool === "bond" ? principals.guarantor : principals.customer,
          `/api/tasks/${taskId}/funding`,
          { pool, amountYocto: toYocto(near(amount)), liabilityYocto: null },
        )
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await call(runtime, clock, asPrincipal(roster.alpha), `/api/tasks/${taskId}/bids`, {
        bid: primaryBid(roster.alpha, taskId, "0.40", clock.now),
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(runtime, clock, asPrincipal(roster.alpha), `/api/tasks/${taskId}/claim`, {}))
      .status,
  ).toBe(200);
}

describe("signed worker failure API", () => {
  it("persists the signed actor, token and cause and replays the request only once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "backstop-worker-failure-"));
    const clock = { now: 1_800_000_000_000 };
    const open = () => createRuntime(() => clock.now, false, join(dir, "state.sqlite"));
    let runtime = open();
    const taskId = "persistent-worker-failure";
    const path = `/api/tasks/${taskId}/failures`;
    const body = { fencingToken: 1, reason: "PROVIDER_TIMEOUT" };
    try {
      await claimTask(runtime, clock, taskId);
      const before = runtime.store.records[taskId];
      const response = await call(
        runtime,
        clock,
        asPrincipal(roster.alpha),
        path,
        body,
        "failure-once",
      );
      expect(response.status).toBe(200);
      const reported = runtime.store.records[taskId];
      expect(reported?.state).toBe("RECOVERY_OPEN");
      expect(reported?.ledger).toEqual(before?.ledger);
      expect(reported?.candidate).toBeNull();
      const events = runtime.store.streams[taskId];
      expect(events?.filter(({ body: event }) => event.type === "attempt_failed")).toMatchObject([
        {
          actor: "alpha",
          body: {
            type: "attempt_failed",
            reason: "PROVIDER_TIMEOUT",
            attempt: 1,
            reportedBy: "alpha",
            fencingToken: 1,
            agents: ["alpha"],
          },
        },
      ]);
      runtime.persistence?.close();
      runtime = open();
      expect(runtime.store.records[taskId]).toEqual(reported);
      expect(runtime.store.streams[taskId]).toEqual(events);
      const replay = await call(
        runtime,
        clock,
        asPrincipal(roster.alpha),
        path,
        body,
        "failure-once",
      );
      expect(replay.status).toBe(200);
      expect(replay.replayed).toBe(true);
      expect(runtime.store.streams[taskId]).toEqual(events);
      const duplicate = await call(runtime, clock, asPrincipal(roster.alpha), path, body);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toMatchObject({ error: { code: "STALE_LEASE" } });
      expect(runtime.store.records[taskId]).toEqual(reported);
    } finally {
      runtime.persistence?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsigned, foreign, stale and malformed reports without changing task state", async () => {
    const clock = { now: 1_800_000_000_000 };
    const runtime = createRuntime(() => clock.now, false);
    const taskId = "failure-auth";
    const path = `/api/tasks/${taskId}/failures`;
    try {
      await claimTask(runtime, clock, taskId);
      const before = runtime.store.records[taskId];
      const unsigned = await handle(
        runtime,
        new Request(`${origin}${path}`, {
          method: "POST",
          body: JSON.stringify({ fencingToken: 1, reason: "PROVIDER_TIMEOUT" }),
        }),
      );
      expect(unsigned.ok).toBe(false);
      const foreign = await call(runtime, clock, asPrincipal(roster.beta), path, {
        fencingToken: 1,
        reason: "PROVIDER_TIMEOUT",
      });
      expect(foreign.status).toBe(409);
      expect(foreign.body).toMatchObject({ error: { code: "STALE_LEASE" } });
      const stale = await call(runtime, clock, asPrincipal(roster.alpha), path, {
        fencingToken: 2,
        reason: "PROVIDER_TIMEOUT",
      });
      expect(stale.status).toBe(409);
      for (const reason of ["VERDICT_REJECTED", "LEASE_EXPIRED", "SUCCESS", "timeout"]) {
        const response = await call(runtime, clock, asPrincipal(roster.alpha), path, {
          fencingToken: 1,
          reason,
        });
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ error: { code: "INVALID_SCHEMA" } });
      }
      const spoof = await call(runtime, clock, asPrincipal(roster.beta), path, {
        agentId: "alpha",
        fencingToken: 1,
        reason: "PROVIDER_TIMEOUT",
      });
      expect(spoof.status).toBe(400);
      expect(runtime.store.records[taskId]).toEqual(before);
    } finally {
      runtime.persistence?.close();
    }
  });
});
