import { describe, expect, it } from "vitest";
import { endorsement, fixtureBids, roster } from "@backstop/agents";
import { digestOf } from "@backstop/shared";
import { advance, replay, run, type Command } from "../src/index.js";
import { assignedTask, record, refusal } from "./support.js";

const finding = (agentId: string, attempt: number, cases: readonly string[]): Command => ({
  kind: "recordFinding",
  agentId,
  attempt,
  findingHash: digestOf({ agentId, attempt, cases }),
  failingCases: cases,
});

function coalitionAssigned() {
  const driver = assignedTask();
  advance(driver, 30_001);
  run(driver, "keeper", { kind: "expireLease" }, "expire");
  const coalition = fixtureBids({
    taskId: driver.taskId,
    epoch: 1,
    nowMs: driver.nowMs,
    bidWindowMs: 10_000,
    excludedAgents: [],
  }).find((signed) => signed.bid.members.length > 1);
  if (coalition === undefined) throw new Error("expected a coalition proposal");
  run(driver, "gamma", { kind: "bid", bid: coalition }, "propose");
  run(
    driver,
    "delta",
    {
      kind: "endorse",
      bidHash: coalition.bidHash,
      endorsement: endorsement(coalition, roster.delta),
    },
    "endorse",
  );
  advance(driver, 10_001);
  run(driver, "keeper", { kind: "closeAuction" }, "close");
  return driver;
}

describe("diagnostic findings", () => {
  it("records a coalition member's finding on the assigned attempt, before and after the claim", () => {
    const driver = coalitionAssigned();
    expect(record(driver)).toMatchObject({ state: "RECOVERY_ASSIGNED", attempt: 2 });
    const posted = run(driver, "delta", finding("delta", 2, ["half-cent-tax-rounds-up"]), "find");
    expect(posted.events.map((event) => event.body)).toEqual([
      {
        type: "finding_recorded",
        attempt: 2,
        agentId: "delta",
        findingHash: digestOf({ agentId: "delta", attempt: 2, cases: ["half-cent-tax-rounds-up"] }),
        failingCases: ["half-cent-tax-rounds-up"],
      },
    ]);
    run(driver, "gamma", { kind: "claim", agentId: "gamma" }, "claim");
    run(driver, "gamma", finding("gamma", 2, []), "lead finding");
    expect(record(driver).findings.map((entry) => entry.agentId)).toEqual(["delta", "gamma"]);
  });

  it("refuses a finding from outside the assigned bid, on a stale attempt, or posted twice", () => {
    const driver = coalitionAssigned();
    expect(refusal(driver, "beta", finding("beta", 2, []))).toBe("UNAUTHORIZED");
    expect(refusal(driver, "kappa", finding("kappa", 2, []))).toBe("UNAUTHORIZED");
    expect(refusal(driver, "delta", finding("delta", 1, []))).toBe("STALE_STATE");
    run(driver, "delta", finding("delta", 2, []), "find");
    expect(refusal(driver, "delta", finding("delta", 2, ["other"]))).toBe("DUPLICATE");
    expect(record(driver).findings).toHaveLength(1);
  });

  it("refuses a finding once the attempt has moved past execution", () => {
    const primary = assignedTask("checkout-finding-late");
    advance(primary, 30_001);
    run(primary, "keeper", { kind: "expireLease" }, "expire");
    expect(record(primary).state).toBe("RECOVERY_OPEN");
    expect(refusal(primary, "alpha", finding("alpha", 1, []))).toBe("STALE_STATE");
  });

  it("replays a log holding findings to the same record, even with duplicated events", () => {
    const driver = coalitionAssigned();
    run(driver, "delta", finding("delta", 2, ["discount-before-tax"]), "find");
    run(driver, "gamma", { kind: "claim", agentId: "gamma" }, "claim");
    const stream = driver.store.streams[driver.taskId] ?? [];
    expect(replay(stream)).toEqual(record(driver));
    expect(replay([...stream, ...stream.slice(-3)])).toEqual(record(driver));
    expect(replay(stream)?.findings).toEqual([
      {
        attempt: 2,
        agentId: "delta",
        findingHash: digestOf({ agentId: "delta", attempt: 2, cases: ["discount-before-tax"] }),
        failingCases: ["discount-before-tax"],
      },
    ]);
  });
});
