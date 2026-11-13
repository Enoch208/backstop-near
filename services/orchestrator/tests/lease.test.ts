import { describe, expect, it } from "vitest";
import { digestOf } from "@backstop/shared";
import { advance, dispatch, run } from "../src/index.js";
import { assignedTask, record, refusal, registry } from "./support.js";

describe("fenced leases", () => {
  it("FR-015 lets only the assigned agent claim, and only once", () => {
    const driver = assignedTask();
    expect(refusal(driver, "beta", { kind: "claim", agentId: "beta" })).toBe("UNAUTHORIZED");
    run(driver, "alpha", { kind: "claim", agentId: "alpha" }, "claim");
    expect(record(driver).lease?.fencingToken).toBe(1);
    expect(refusal(driver, "alpha", { kind: "claim", agentId: "alpha" })).toBe("LEASE_HELD");
  });

  it("refuses a write that names the wrong fencing token", () => {
    const driver = assignedTask();
    run(driver, "alpha", { kind: "claim", agentId: "alpha" }, "claim");
    expect(refusal(driver, "alpha", { kind: "heartbeat", agentId: "alpha", fencingToken: 2 })).toBe(
      "STALE_LEASE",
    );
    expect(
      refusal(driver, "alpha", {
        kind: "submit",
        agentId: "alpha",
        fencingToken: 0,
        artifactHash: digestOf("x"),
        checkpointHash: null,
      }),
    ).toBe("STALE_LEASE");
  });

  it("TC-003 heartbeats keep the lease alive; silence past the grace period opens recovery", () => {
    const driver = assignedTask();
    run(driver, "alpha", { kind: "claim", agentId: "alpha" }, "claim");
    advance(driver, 25_000);
    run(driver, "alpha", { kind: "heartbeat", agentId: "alpha", fencingToken: 1 }, "beat");
    advance(driver, 34_000);
    expect(refusal(driver, "keeper", { kind: "expireLease" })).toBe("POLICY_VIOLATION");
    advance(driver, 2_000);
    run(driver, "keeper", { kind: "expireLease" }, "expire");
    expect(record(driver).state).toBe("RECOVERY_OPEN");
    expect(record(driver).excludedAgents).toEqual(["alpha"]);
  });

  it("fails an assignment nobody claims before its claim window closes", () => {
    const driver = assignedTask();
    advance(driver, 30_001);
    run(driver, "keeper", { kind: "expireLease" }, "expire");
    expect(record(driver).state).toBe("RECOVERY_OPEN");
  });

  it("rejects a checkpoint that does not extend the latest one", () => {
    const driver = assignedTask();
    run(driver, "alpha", { kind: "claim", agentId: "alpha" }, "claim");
    const checkpoint = {
      taskId: driver.taskId,
      attempt: 1,
      stateVersion: record(driver).version,
      contentHash: digestOf("partial"),
      artifactUri: "fixture://partial",
      validatedSubtasks: [],
      provenanceEventIds: [],
      parentCheckpointHash: digestOf("not the latest"),
    };
    expect(
      refusal(driver, "alpha", {
        kind: "checkpoint",
        agentId: "alpha",
        fencingToken: 1,
        checkpoint,
      }),
    ).toBe("STALE_STATE");
  });

  it("NFR-007 compare-and-swap: a writer holding an old version is refused", () => {
    const driver = assignedTask();
    const version = record(driver).version;
    const context = { nowMs: driver.nowMs, registry };
    const first = dispatch(
      driver.store,
      {
        taskId: driver.taskId,
        actor: "alpha",
        command: { kind: "claim", agentId: "alpha" },
        expectedVersion: version,
      },
      context,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const raced = dispatch(
      first.value.store,
      {
        taskId: driver.taskId,
        actor: "alpha",
        command: { kind: "claim", agentId: "alpha" },
        expectedVersion: version,
      },
      context,
    );
    expect(raced.ok ? null : raced.failure.code).toBe("STALE_STATE");
  });
});
