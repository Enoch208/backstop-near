import { readFileSync } from "node:fs";
import { principals, primaryBid, roster } from "@backstop/agents";
import { checkoutManifest } from "@backstop/fixture-checkout";
import {
  digestOf,
  repairBriefSchema,
  repairRunnerId,
  repairTaskSchema,
  suiteHash,
} from "@backstop/shared";
import { describe, expect, it } from "vitest";
import { call, read, testRuntime } from "./support.js";

const task = repairTaskSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../fixtures/repair/normalize-intervals.json", import.meta.url),
      "utf8",
    ),
  ),
);

function setup() {
  const { runtime, clock } = testRuntime();
  const taskId = "unfamiliar-job";
  const basis = checkoutManifest({ taskId, createdAtMs: clock.now, maxAttempts: 3 });
  const manifest = {
    ...basis,
    objective: task.objective,
    suite: {
      suiteId: task.suite.suiteId,
      suiteHash: suiteHash(task.suite),
      runnerId: repairRunnerId,
    },
    repairTaskHash: digestOf(task),
  };
  return { runtime, clock, manifest, path: `/api/tasks/${taskId}` };
}

describe("customer-supplied repair tasks", () => {
  it("pins the original source and suite, and gives the workers a brief without the oracle", async () => {
    const { runtime, clock, manifest, path } = setup();
    const bad = await call(runtime, clock, principals.customer, "/api/tasks", {
      manifest,
      repairTask: { ...task, source: `${task.source}\n` },
    });
    expect(bad.status).toBe(422);
    const created = await call(runtime, clock, principals.customer, "/api/tasks", {
      manifest,
      repairTask: task,
    });
    expect(created.status).toBe(201);
    const brief = await read(runtime, `${path}/repair`);
    expect(repairBriefSchema.parse(brief.body)).toEqual({
      source: task.source,
      rules: task.rules,
      primaryMilestone: task.primaryMilestone,
      suite: {
        suiteId: task.suite.suiteId,
        entry: task.suite.entry,
        cases: task.suite.cases.filter((testCase) => testCase.visibility === "public"),
      },
      probes: [
        {
          input: task.challengeInputs?.[0],
          expected: [
            [1, 3],
            [3, 4],
            [5, 6],
          ],
        },
        { input: task.challengeInputs?.[1], expected: [[6, 14]] },
      ],
    });
  });

  it("rejects code that satisfies the public examples but fails the customer’s held-out cases", async () => {
    const { runtime, clock, manifest, path } = setup();
    expect(
      (
        await call(runtime, clock, principals.customer, "/api/tasks", {
          manifest,
          repairTask: task,
        })
      ).status,
    ).toBe(201);
    for (const [pool, amountYocto] of [
      ["escrow", manifest.budget.escrowYocto],
      ["premium", manifest.budget.premiumYocto],
    ]) {
      expect(
        (
          await call(runtime, clock, principals.customer, `${path}/funding`, {
            pool: pool ?? "",
            amountYocto: amountYocto ?? "",
            liabilityYocto: null,
          })
        ).status,
      ).toBe(200);
    }
    const bond = manifest.guarantee?.maxLiabilityYocto ?? "0";
    expect(
      (
        await call(runtime, clock, principals.guarantor, `${path}/funding`, {
          pool: "bond",
          amountYocto: bond,
          liabilityYocto: bond,
        })
      ).status,
    ).toBe(200);
    const alpha = {
      id: roster.alpha.agentId,
      account: roster.alpha.account,
      key: roster.alpha.key,
    };
    expect(
      (
        await call(runtime, clock, alpha, `${path}/bids`, {
          bid: primaryBid(roster.alpha, manifest.taskId, "0.30", clock.now),
        })
      ).status,
    ).toBe(200);
    expect((await call(runtime, clock, alpha, `${path}/claim`, {})).status).toBe(200);
    const result = await call(runtime, clock, alpha, `${path}/artifacts`, {
      fencingToken: 1,
      source:
        "function mergeIntervals(ranges) { return ranges.length === 0 ? [] : [[1, 6], [8, 11]]; }",
      checkpointHash: null,
    });
    expect(result.status).toBe(201);
    const verification = runtime.store.streams[manifest.taskId]?.find(
      (event) => event.body.type === "verification_recorded",
    );
    expect(verification?.body).toMatchObject({
      type: "verification_recorded",
      evidence: {
        body: { runnerId: repairRunnerId, verdict: "REJECT", totals: { passed: 2, failed: 2 } },
      },
    });
    expect(runtime.store.records[manifest.taskId]?.state).toBe("RECOVERY_OPEN");
  });
});
