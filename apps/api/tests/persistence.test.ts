import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asPrincipal, principals, primaryBid, roster } from "@backstop/agents";
import { candidate, checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { near, toYocto } from "@backstop/shared";
import { afterEach, expect, it } from "vitest";
import { createRuntime, tick, type Runtime } from "../src/index.js";
import { call, read } from "./support.js";

const paths: string[] = [];
const runtimes = new Set<Runtime>();

afterEach(() => {
  for (const runtime of runtimes) runtime.persistence?.close();
  runtimes.clear();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

it("restores a checkpoint, lease, signed reply and recovery after reopening the coordinator", async () => {
  const dir = mkdtempSync(join(tmpdir(), "backstop-restart-"));
  paths.push(dir);
  const state = join(dir, "state.sqlite");
  const clock = { now: 1_800_000_000_000 };
  const open = () => {
    const runtime = createRuntime(() => clock.now, false, state);
    runtimes.add(runtime);
    return runtime;
  };
  const taskId = "restart-checkpoint";
  const base = `/api/tasks/${taskId}`;
  const manifest = checkoutManifest({
    taskId,
    createdAtMs: clock.now,
    maxAttempts: 3,
    timing: liveTiming,
  });
  const runtime = open();
  expect(() => createRuntime(() => clock.now, false, state)).toThrow("Another coordinator");
  expect((await call(runtime, clock, principals.customer, "/api/tasks", { manifest })).status).toBe(
    201,
  );
  const fund = (pool: string, amount: string) => ({
    pool,
    amountYocto: toYocto(near(amount)),
    liabilityYocto: null,
  });
  const funding = `${base}/funding`;
  await call(runtime, clock, principals.customer, funding, fund("escrow", "0.40"));
  await call(runtime, clock, principals.customer, funding, fund("premium", "0.04"));
  await call(runtime, clock, principals.guarantor, funding, fund("bond", "0.25"));
  const alpha = asPrincipal(roster.alpha);
  await call(runtime, clock, alpha, `${base}/bids`, {
    bid: primaryBid(roster.alpha, taskId, "0.30", clock.now),
  });
  await call(runtime, clock, alpha, `${base}/claim`, {});
  const work = candidate("alpha-partial");
  const lease = runtime.store.records[taskId]?.lease;
  expect(lease).toBeDefined();
  if (lease === undefined || lease === null) throw new Error("Missing task lease");
  const wire = {
    fencingToken: lease.fencingToken,
    checkpoint: {
      taskId,
      attempt: 1,
      stateVersion: runtime.store.records[taskId]?.version ?? 0,
      contentHash: work.artifactHash,
      artifactUri: "fixture://alpha-partial.js",
      validatedSubtasks: ["discount-order"],
      parentCheckpointHash: null,
      provenanceEventIds: [],
    },
    source: work.source,
  };
  const checkpoint = `${base}/checkpoints`;
  const first = await call(runtime, clock, alpha, checkpoint, wire, "durable-checkpoint-1");
  expect(first.status).toBe(200);
  const priorVersion = runtime.store.records[taskId]?.version;
  runtime.persistence?.close();
  runtimes.delete(runtime);

  const restarted = open();
  expect(restarted.store.records[taskId]?.version).toBe(priorVersion);
  expect(restarted.store.records[taskId]?.lease).toEqual(lease);
  expect((await read(restarted, `${base}/artifacts/${work.artifactHash}`)).body.source).toBe(
    work.source,
  );
  const duplicate = await call(restarted, clock, alpha, checkpoint, wire, "durable-checkpoint-1");
  expect(duplicate).toEqual({ ...first, replayed: true });
  const collision = await call(
    restarted,
    clock,
    alpha,
    `${base}/heartbeat`,
    {
      fencingToken: lease.fencingToken,
    },
    "durable-checkpoint-1",
  );
  expect(collision.status).toBe(409);
  clock.now = lease.expiresAtMs + manifest.policy.heartbeatGraceMs + 1;
  tick(restarted);
  expect(restarted.store.records[taskId]?.state).toBe("RECOVERY_OPEN");
  const stale = await call(restarted, clock, alpha, `${base}/heartbeat`, {
    fencingToken: lease.fencingToken,
  });
  expect(stale.body).toMatchObject({ error: { code: "STALE_LEASE" } });
});
