import { describe, expect, it } from "vitest";
import { roster, signBid, type FixtureAgent } from "@backstop/agents";
import { digestOf, leadAgent, near, toYocto, type Bid, type SignedBid } from "@backstop/shared";
import { type DecisionContext, type TaskRecord } from "../src/index.js";
import { decideCloseAuction } from "../src/core/decide-market.js";
import { exhaustedFailureDomain } from "../src/core/recovery-routing.js";
import { assignedTask, record, registry } from "./support.js";

function scenario() {
  const driver = assignedTask("diversification");
  const base = record(driver);
  const closesAtMs = driver.nowMs + 10_000;
  const makeBid = (agent: FixtureAgent, price: string, changes: Partial<Bid> = {}) => {
    const amountYocto = toYocto(near(price));
    return signBid(
      {
        taskId: base.taskId,
        epoch: 2,
        amountYocto,
        committedAtMs: closesAtMs - 500,
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
        ...changes,
      },
      agent,
    );
  };
  const ordinary = makeBid(roster.gamma, "0.44");
  const standby = makeBid(roster.epsilon, "0.52", { purpose: "standby" });
  const task: TaskRecord = {
    ...base,
    state: "RECOVERY_OPEN",
    attempt: 2,
    epoch: 2,
    manifest: { ...base.manifest, policy: { ...base.manifest.policy, recoveryStrategy: "patch" } },
    assignment: null,
    auction: { epoch: 2, closesAtMs, bids: [ordinary], proposals: [] },
    excludedAgents: ["alpha", "beta"],
    failures: [
      { attempt: 1, reason: "VERDICT_REJECTED", agents: ["alpha"] },
      { attempt: 2, reason: "VERDICT_REJECTED", agents: ["beta"] },
    ],
    recoveryFeedback: [1, 2].map((attempt) => ({
      attempt,
      artifactHash: digestOf(attempt),
      publicFailedCaseIds: [],
      heldOutFailures: 1,
      executionErrors: 0,
    })),
    standby: [standby],
    standbyAvailability: { [standby.bidHash]: 2 },
  };
  const context: DecisionContext = {
    nowMs: closesAtMs + 1,
    registry: {
      ...registry,
      agentFailureDomains: {
        alpha: "provider-a",
        beta: "provider-a",
        gamma: "provider-a",
        epsilon: "provider-b",
        delta: "provider-c",
      },
    },
  };
  return { task, ordinary, standby, makeBid, context };
}

function winner(task: TaskRecord, context: DecisionContext): SignedBid {
  const outcome = decideCloseAuction(task, context);
  if (!outcome.ok) throw new Error(outcome.failure.message);
  const assignment = outcome.value.find((event) => event.type === "attempt_assigned");
  if (assignment?.type !== "attempt_assigned") throw new Error("Expected an award");
  return assignment.bid;
}

describe("provider diversification after verified failures", () => {
  it("uses ready independent standby on the final attempt and preserves its signed price", () => {
    const { task, context, ordinary, standby } = scenario();
    expect(winner(task, context)).toEqual(standby);
    const outcome = decideCloseAuction(task, context);
    expect(outcome).toMatchObject({
      ok: true,
      value: [
        { type: "standby_activated", bidHash: standby.bidHash },
        {
          type: "recovery_awarded",
          winner: standby.bidHash,
          rejected: [{ bidHash: ordinary.bidHash }],
        },
        { type: "attempt_assigned", attempt: 3 },
      ],
    });
    if (!outcome.ok) throw new Error(outcome.failure.message);
    const award = outcome.value.find((event) => event.type === "recovery_awarded");
    if (award?.type !== "recovery_awarded") throw new Error("Missing award");
    expect(award.rejected.find(({ bidHash }) => bidHash === ordinary.bidHash)?.reason).toContain(
      "diversif",
    );
    expect(task.ledger.transfers).toEqual([]);
  });

  it("selects the cheapest eligible independent domain across ordinary and standby tiers", () => {
    const { task, context, makeBid } = scenario();
    if (task.auction === null) throw new Error("Missing auction");
    const independent = makeBid(roster.delta, "0.50");
    const changed = {
      ...task,
      auction: { ...task.auction, bids: [...task.auction.bids, independent] },
    };
    expect(winner(changed, context)).toEqual(independent);
    const outcome = decideCloseAuction(changed, context);
    if (!outcome.ok) throw new Error(outcome.failure.message);
    expect(outcome.value.some((event) => event.type === "standby_activated")).toBe(false);
    const award = outcome.value.find((event) => event.type === "recovery_awarded");
    if (award?.type !== "recovery_awarded") throw new Error("Missing award");
    expect(award.rejected.some(({ bidHash }) => bidHash === independent.bidHash)).toBe(false);
  });

  it("leaves the quote-aware fixed order unchanged with identical feedback and providers", () => {
    const { task, context, ordinary } = scenario();
    const fixed = {
      ...task,
      manifest: {
        ...task.manifest,
        policy: {
          ...task.manifest.policy,
          recoveryOrder: ["gamma", "epsilon"],
        },
      },
    };
    expect(exhaustedFailureDomain(fixed, context.registry)).toBeUndefined();
    expect(winner(fixed, context)).toEqual(ordinary);
  });

  it.each(["crashed primary", "different primary domain"] as const)(
    "switches after a verified recovery rejection with a %s",
    (kind) => {
      const { task, context, standby } = scenario();
      const changed: TaskRecord = {
        ...task,
        failures: [
          {
            attempt: 1,
            reason: kind === "crashed primary" ? "LEASE_EXPIRED" : "VERDICT_REJECTED",
            agents: ["alpha"],
          },
          { attempt: 2, reason: "VERDICT_REJECTED", agents: ["beta"] },
        ],
        recoveryFeedback: task.recoveryFeedback.filter(({ attempt }) => attempt === 2),
      };
      const nextContext = {
        ...context,
        registry: {
          ...context.registry,
          agentFailureDomains: {
            ...context.registry.agentFailureDomains,
            alpha: "provider-c",
          },
        },
      };
      expect(exhaustedFailureDomain(changed, nextContext.registry)).toBe("provider-a");
      expect(winner(changed, nextContext)).toEqual(standby);
    },
  );

  it.each([
    "early",
    "crash",
    "missing-feedback",
    "unknown-domain",
    "no-policy",
    "stale",
    "coalition",
    "prototype-name",
  ] as const)("does not infer provider exhaustion from %s evidence", (kind) => {
    const { task, context, ordinary } = scenario();
    const noPolicy = { ...task.manifest.policy };
    delete noPolicy.recoveryStrategy;
    const changed: TaskRecord = {
      ...task,
      ...(kind === "early"
        ? { manifest: { ...task.manifest, policy: { ...task.manifest.policy, maxAttempts: 4 } } }
        : {}),
      ...(kind === "no-policy" ? { manifest: { ...task.manifest, policy: noPolicy } } : {}),
      ...(kind === "missing-feedback"
        ? { recoveryFeedback: task.recoveryFeedback.slice(0, 1) }
        : {}),
      ...(kind === "crash"
        ? {
            failures: [
              { attempt: 1, reason: "VERDICT_REJECTED", agents: ["alpha"] },
              { attempt: 2, reason: "LEASE_EXPIRED", agents: ["beta"] },
            ],
          }
        : {}),
      ...(kind === "stale"
        ? { failures: [{ attempt: 1, reason: "VERDICT_REJECTED", agents: ["alpha"] }] }
        : {}),
      ...(kind === "coalition"
        ? { failures: task.failures.map((failure) => ({ ...failure, agents: ["alpha", "beta"] })) }
        : {}),
      ...(kind === "prototype-name"
        ? { failures: [{ attempt: 2, reason: "VERDICT_REJECTED", agents: ["constructor"] }] }
        : {}),
    };
    const nextContext: DecisionContext = {
      ...context,
      registry: kind === "unknown-domain" ? registry : context.registry,
    };
    expect(exhaustedFailureDomain(changed, nextContext.registry)).toBeUndefined();
    expect(winner(changed, nextContext)).toEqual(ordinary);
  });

  it.each([
    "expired",
    "busy",
    "over-budget",
    "unready",
    "excluded",
    "unknown",
    "insufficient-time",
    "wrong-epoch",
    "prototype-name",
  ] as const)("falls back without bypassing an independent offer's %s guard", (kind) => {
    const { task, context, ordinary, standby, makeBid } = scenario();
    const replacement =
      kind === "expired"
        ? makeBid(roster.epsilon, "0.52", { purpose: "standby", expiresAtMs: context.nowMs - 1 })
        : kind === "over-budget"
          ? makeBid(roster.epsilon, "0.66", { purpose: "standby" })
          : kind === "insufficient-time"
            ? makeBid(roster.epsilon, "0.52", {
                purpose: "standby",
                estimatedDurationMs: task.manifest.deadlineMs - context.nowMs + 1,
              })
            : kind === "wrong-epoch"
              ? makeBid(roster.epsilon, "0.52", { purpose: "standby", epoch: 1 })
              : kind === "prototype-name"
                ? makeBid({ ...roster.epsilon, agentId: "constructor" }, "0.52", {
                    purpose: "standby",
                  })
                : standby;
    const changed: TaskRecord = {
      ...task,
      standby: [replacement],
      standbyAvailability: kind === "unready" ? {} : { [replacement.bidHash]: 2 },
      ...(kind === "excluded" ? { excludedAgents: [...task.excludedAgents, "epsilon"] } : {}),
    };
    const nextContext: DecisionContext = {
      ...context,
      ...(kind === "busy" ? { busyAgents: new Set(["epsilon"]) } : {}),
      ...(kind === "unknown"
        ? {
            registry: {
              ...context.registry,
              agentFailureDomains: { alpha: "provider-a", beta: "provider-a", gamma: "provider-a" },
            },
          }
        : {}),
    };
    expect(leadAgent(winner(changed, nextContext).bid)).toBe(leadAgent(ordinary.bid));
  });
});
