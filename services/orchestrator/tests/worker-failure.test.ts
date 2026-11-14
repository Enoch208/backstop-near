import { describe, expect, it } from "vitest";
import { roster, signBid, type FixtureAgent } from "@backstop/agents";
import {
  digestOf,
  near,
  toYocto,
  type FailureReason,
  type WorkerFailureReason,
} from "@backstop/shared";
import { advance, replay, run, type DecisionContext, type TaskRecord } from "../src/index.js";
import { decideCloseAuction } from "../src/core/decide-market.js";
import { exhaustedFailureDomain } from "../src/core/recovery-routing.js";
import { assignedTask, record, refusal, registry } from "./support.js";

function claimedTask() {
  const driver = assignedTask("reported-failure");
  run(driver, "alpha", { kind: "claim", agentId: "alpha" }, "claim");
  return driver;
}

describe("fenced worker failure reports", () => {
  it.each<WorkerFailureReason>(["PROVIDER_TIMEOUT", "PROMPT_LIMIT", "INVALID_OUTPUT"])(
    "opens recovery immediately for %s without releasing money",
    (reason) => {
      const driver = claimedTask();
      const before = record(driver);
      const step = run(
        driver,
        "alpha",
        {
          kind: "reportFailure",
          agentId: "alpha",
          fencingToken: 1,
          reason,
        },
        "report",
      );
      expect(step.events.map(({ body }) => body)).toEqual([
        {
          type: "attempt_failed",
          attempt: 1,
          reason,
          agents: ["alpha"],
          reportedBy: "alpha",
          fencingToken: 1,
        },
        {
          type: "recovery_opened",
          epoch: 1,
          reason,
          closesAtMs: driver.nowMs + before.manifest.policy.bidWindowMs,
        },
      ]);
      const after = record(driver);
      expect(after.state).toBe("RECOVERY_OPEN");
      expect(
        refusal(driver, "alpha", { kind: "heartbeat", agentId: "alpha", fencingToken: 1 }),
      ).toBe("STALE_LEASE");
      expect(after.failures).toEqual([{ attempt: 1, reason, agents: ["alpha"] }]);
      expect(after.ledger).toEqual(before.ledger);
      expect(after.recoveryFeedback).toEqual([]);
      expect(replay(driver.store.streams[driver.taskId] ?? [])).toEqual(after);
    },
  );

  it.each(["wrong-owner", "stale-token", "expired", "unclaimed", "double"] as const)(
    "refuses %s reports without changing state or balances",
    (kind) => {
      const driver = kind === "unclaimed" ? assignedTask("unclaimed-failure") : claimedTask();
      const command = {
        kind: "reportFailure",
        agentId: kind === "wrong-owner" ? "beta" : "alpha",
        fencingToken: kind === "stale-token" ? 2 : 1,
        reason: "PROVIDER_TIMEOUT",
      } as const;
      if (kind === "expired") {
        const current = record(driver);
        if (current.lease === null) throw new Error("Missing lease");
        advance(
          driver,
          current.lease.expiresAtMs + current.manifest.policy.heartbeatGraceMs - driver.nowMs + 1,
        );
      }
      if (kind === "double") run(driver, "alpha", command, "first report");
      const before = driver.store;
      expect(refusal(driver, command.agentId, command)).toBe("STALE_LEASE");
      expect(driver.store).toBe(before);
    },
  );
});

function routingScenario(reason: FailureReason, attempt = 1) {
  const driver = claimedTask();
  run(
    driver,
    "alpha",
    { kind: "reportFailure", agentId: "alpha", fencingToken: 1, reason: "PROVIDER_TIMEOUT" },
    "report",
  );
  const base = record(driver);
  if (base.auction === null) throw new Error("Missing auction");
  const makeBid = (agent: FixtureAgent, price: string, standby: boolean) => {
    const amountYocto = toYocto(near(price));
    return signBid(
      {
        taskId: base.taskId,
        epoch: base.epoch,
        amountYocto,
        committedAtMs: driver.nowMs,
        expiresAtMs: base.manifest.deadlineMs,
        estimatedDurationMs: 1_000,
        planHash: digestOf(agent.agentId),
        members: [
          {
            agentId: agent.agentId,
            account: agent.account,
            role: "repairer",
            shareYocto: amountYocto,
          },
        ],
        ...(standby ? { purpose: "standby" as const } : {}),
      },
      agent,
    );
  };
  const ordinary = makeBid(roster.gamma, "0.44", false);
  const standby = makeBid(roster.epsilon, "0.52", true);
  const task: TaskRecord = {
    ...base,
    attempt,
    manifest: { ...base.manifest, policy: { ...base.manifest.policy, recoveryStrategy: "patch" } },
    failures: [{ attempt, reason, agents: ["alpha"] }],
    auction: { ...base.auction, bids: [ordinary] },
    standby: [standby],
    standbyAvailability: { [standby.bidHash]: base.epoch },
  };
  const context: DecisionContext = {
    nowMs: base.auction.closesAtMs + 1,
    registry: {
      ...registry,
      agentFailureDomains: { alpha: "near", gamma: "near", epsilon: "openai" },
    },
  };
  return { task, context, ordinary, standby };
}

function winner(task: TaskRecord, context: DecisionContext) {
  const decision = decideCloseAuction(task, context);
  if (!decision.ok) throw new Error(decision.failure.message);
  const assignment = decision.value.find((event) => event.type === "attempt_assigned");
  if (assignment?.type !== "attempt_assigned") throw new Error("Missing assignment");
  return assignment.bid;
}

describe("provider timeout recovery routing", () => {
  it.each([1, 2])("uses an independent ready provider after attempt %i times out", (attempt) => {
    const { task, context, standby } = routingScenario("PROVIDER_TIMEOUT", attempt);
    expect(exhaustedFailureDomain(task, context.registry)).toBe("near");
    expect(winner(task, context)).toEqual(standby);
    expect(task.ledger.transfers).toEqual([]);
  });

  it.each<FailureReason>(["LEASE_EXPIRED", "PROMPT_LIMIT", "INVALID_OUTPUT"])(
    "does not attribute %s to provider quality or availability",
    (reason) => {
      const { task, context, ordinary } = routingScenario(reason);
      expect(exhaustedFailureDomain(task, context.registry)).toBeUndefined();
      expect(winner(task, context)).toEqual(ordinary);
    },
  );

  it.each([
    "fixed-order",
    "missing-domain",
    "missing-policy",
    "unknown-backup",
    "unready-backup",
  ] as const)("preserves normal selection with %s", (kind) => {
    const { task, context, ordinary } = routingScenario("PROVIDER_TIMEOUT");
    const policy = { ...task.manifest.policy };
    if (kind === "fixed-order") policy.recoveryOrder = ["gamma", "epsilon"];
    if (kind === "missing-policy") delete policy.recoveryStrategy;
    const changed = {
      ...task,
      manifest: { ...task.manifest, policy },
      ...(kind === "unready-backup" ? { standbyAvailability: {} } : {}),
    };
    const nextContext = {
      ...context,
      registry:
        kind === "missing-domain"
          ? registry
          : kind === "unknown-backup"
            ? { ...registry, agentFailureDomains: { alpha: "near", gamma: "near" } }
            : context.registry,
    };
    expect(winner(changed, nextContext)).toEqual(ordinary);
  });
});
