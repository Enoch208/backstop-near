import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asPrincipal,
  primaryBid,
  principals,
  roster,
  signBid,
  type FixtureAgent,
} from "@backstop/agents";
import { checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import {
  digestOf,
  near,
  repairRunnerId,
  signValue,
  signingKeyFromSeed,
  suiteHash,
  toYocto,
  type RepairTask,
} from "@backstop/shared";
import { expect, test } from "vitest";
import { createRuntime, handle, tick, type Runtime } from "../src/index.js";
import { call, origin } from "./support.js";

const repairTask: RepairTask = {
  objective: "Add one.",
  rules: "Return the input plus one.",
  source: "function increment(n) { return n; }",
  suite: {
    suiteId: "standby-increment",
    entry: "increment",
    oracleSource: "function increment(n) { return n + 1; }",
    cases: [
      { id: "public", input: 2, expected: 3, visibility: "public" },
      { id: "hidden", input: -4, expected: -3, visibility: "held_out" },
    ],
  },
};

function worker(id: string): FixtureAgent {
  return { agentId: id, key: signingKeyFromSeed(id), account: `${id}.testnet`, role: "repairer" };
}

async function register(runtime: Runtime, agent: FixtureAgent) {
  const claim = {
    agentId: agent.agentId,
    publicKey: agent.key.publicKey,
    account: agent.account,
    role: agent.role,
  };
  const response = await handle(
    runtime,
    new Request(`${origin}/api/agents`, {
      method: "POST",
      body: JSON.stringify({ claim, proof: signValue(claim, agent.key) }),
    }),
  );
  expect(response.status).toBe(201);
}

test("restores a signed booking, prevents double booking and only awards a ready standby", async () => {
  const dir = mkdtempSync(join(tmpdir(), "backstop-standby-"));
  const clock = { now: 1_800_000_000_000 };
  const open = () => createRuntime(() => clock.now, false, join(dir, "state.sqlite"));
  let runtime = open();
  try {
    const ready = worker("reserve-ready");
    const absent = worker("reserve-absent");
    await register(runtime, ready);
    await register(runtime, absent);
    const create = async (taskId: string) => {
      const manifest = {
        ...checkoutManifest({
          taskId,
          createdAtMs: clock.now,
          timing: { ...liveTiming, bidWindowMs: 1_000 },
          maxAttempts: 3,
        }),
        objective: repairTask.objective,
        repairTaskHash: digestOf(repairTask),
        suite: {
          suiteId: repairTask.suite.suiteId,
          suiteHash: suiteHash(repairTask.suite),
          runnerId: repairRunnerId,
        },
      };
      expect(
        (await call(runtime, clock, principals.customer, "/api/tasks", { manifest, repairTask }))
          .status,
      ).toBe(201);
      for (const [pool, amount] of [
        ["escrow", "0.40"],
        ["premium", "0.04"],
        ["bond", "0.25"],
      ] as const) {
        const signer = pool === "bond" ? principals.guarantor : principals.customer;
        expect(
          (
            await call(runtime, clock, signer, `/api/tasks/${taskId}/funding`, {
              pool,
              amountYocto: toYocto(near(amount)),
              liabilityYocto: null,
            })
          ).status,
        ).toBe(200);
      }
      return manifest;
    };
    const task = await create("standby-restart");
    const other = await create("standby-conflict");
    const bid = (agent: FixtureAgent, taskId: string, price: string, epoch = 1) => {
      const amountYocto = toYocto(near(price));
      return signBid(
        {
          taskId,
          epoch,
          amountYocto,
          purpose: "standby",
          committedAtMs: clock.now,
          expiresAtMs: task.deadlineMs,
          planHash: digestOf("repair"),
          estimatedDurationMs: 8_000,
          members: [
            {
              agentId: agent.agentId,
              account: agent.account,
              shareYocto: amountYocto,
              role: "repairer",
            },
          ],
        },
        agent,
      );
    };
    const reserve = (agent: FixtureAgent, taskId: string, price: string, epoch?: number) =>
      call(runtime, clock, asPrincipal(agent), `/api/tasks/${taskId}/bids`, {
        bid: bid(agent, taskId, price, epoch),
      });
    expect((await reserve(ready, task.taskId, "0.66")).body).toMatchObject({
      error: { code: "BUDGET_EXCEEDED" },
    });
    expect((await reserve(ready, task.taskId, "0.52")).status).toBe(200);
    expect((await reserve(absent, task.taskId, "0.50")).status).toBe(200);
    expect((await reserve(ready, other.taskId, "0.52")).body).toMatchObject({
      error: { code: "POLICY_VIOLATION" },
    });
    const base = `/api/tasks/${task.taskId}`;
    expect(
      (
        await call(runtime, clock, asPrincipal(roster.alpha), `${base}/bids`, {
          bid: primaryBid(roster.alpha, task.taskId, "0.40", clock.now),
        })
      ).status,
    ).toBe(200);
    runtime.persistence?.close();
    runtime = open();
    expect(runtime.store.records[task.taskId]?.standby).toHaveLength(2);
    clock.now += task.policy.leaseMs + 1;
    tick(runtime);
    clock.now += 1_500;
    tick(runtime);
    expect(runtime.store.records[task.taskId]?.state).toBe("RECOVERY_OPEN");
    const readyPath = `${base}/standby/ready`;
    expect((await call(runtime, clock, asPrincipal(ready), readyPath, { epoch: 2 })).status).toBe(
      409,
    );
    expect((await call(runtime, clock, asPrincipal(ready), readyPath, { epoch: 1 })).status).toBe(
      200,
    );
    clock.now += 1;
    tick(runtime);
    const final = runtime.store.records[task.taskId];
    expect(final?.state).toBe("RECOVERY_ASSIGNED");
    expect(final?.assignment?.bid.bid.members[0]?.agentId).toBe(ready.agentId);
    expect(final?.assignment?.bid.bid.purpose).toBe("standby");
    expect(runtime.store.streams[task.taskId]?.map(({ body }) => body.type)).toContain(
      "standby_activated",
    );
    expect(final?.ledger.transfers).toEqual([]);
  } finally {
    runtime.persistence?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
