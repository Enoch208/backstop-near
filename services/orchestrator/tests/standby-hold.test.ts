import { describe, expect, it } from "vitest";
import { roster, signBid } from "@backstop/agents";
import { digestOf, near, toYocto } from "@backstop/shared";
import { advance, evolve, run, type TaskRecord } from "../src/index.js";
import { decideBid, decideCloseAuction, decideConfirmStandby } from "../src/core/decide-market.js";
import { assignedTask, record, registry } from "./support.js";

function waiting() {
  const driver = assignedTask("standby-hold");
  advance(driver, 30_001);
  run(driver, "keeper", { kind: "expireLease" }, "expire");
  const opened = record(driver);
  if (opened.auction === null) throw new Error("Missing auction");
  const amount = toYocto(near("0.52"));
  const standby = signBid(
    {
      taskId: driver.taskId,
      epoch: opened.epoch,
      purpose: "standby",
      committedAtMs: driver.nowMs,
      expiresAtMs: opened.manifest.deadlineMs,
      estimatedDurationMs: 1_000,
      amountYocto: amount,
      planHash: digestOf("standby"),
      members: [
        {
          agentId: roster.beta.agentId,
          account: roster.beta.account,
          role: "repairer",
          shareYocto: amount,
        },
      ],
    },
    roster.beta,
  );
  const task: TaskRecord = {
    ...opened,
    manifest: {
      ...opened.manifest,
      policy: { ...opened.manifest.policy, leaseMs: 1_200, heartbeatGraceMs: 750 },
    },
    standby: [standby],
  };
  return { task, standby, close: opened.auction.closesAtMs };
}

describe("a bounded hold for precommitted standby readiness", () => {
  it("holds an empty auction, accepts delayed readiness, and then assigns the standby", () => {
    const { task, standby, close } = waiting();
    const held = decideCloseAuction(task, { nowMs: close + 1, registry });
    expect(held).toMatchObject({ ok: false, failure: { code: "POLICY_VIOLATION" } });
    expect(task.state).toBe("RECOVERY_OPEN");
    const ready = decideConfirmStandby(task, roster.beta.agentId, task.epoch, {
      nowMs: close + 500,
      registry,
    });
    if (!ready.ok || ready.value[0] === undefined) throw new Error("Expected standby readiness");
    const next = evolve(task, {
      taskId: task.taskId,
      eventId: `${task.taskId}#${String(task.version + 1)}`,
      version: task.version + 1,
      atMs: close + 500,
      actor: roster.beta.agentId,
      body: ready.value[0],
    });
    const award = decideCloseAuction(next, { nowMs: close + 501, registry });
    expect(award).toMatchObject({
      ok: true,
      value: [
        { type: "standby_activated", bidHash: standby.bidHash },
        { type: "recovery_awarded", winner: standby.bidHash },
        { type: "attempt_assigned" },
      ],
    });
    expect(next.ledger.transfers).toEqual([]);
  });

  it("does not extend the hold with repeated close requests", () => {
    const { task, close } = waiting();
    for (const delay of [1, 500, 1_949, 1_950])
      expect(decideCloseAuction(task, { nowMs: close + delay, registry }).ok).toBe(false);
    const context = { nowMs: close + 1_951, registry };
    expect(decideCloseAuction(task, context)).toMatchObject({
      ok: true,
      value: [{ type: "terminal_failure", reason: "NO_ELIGIBLE_BIDS" }],
    });
    expect(decideConfirmStandby(task, roster.beta.agentId, task.epoch, context)).toMatchObject({
      ok: false,
      failure: { code: "BID_WINDOW_CLOSED" },
    });
  });

  it("keeps ordinary bids closed during the standby hold", () => {
    const { task, standby, close } = waiting();
    const { purpose, ...bid } = standby.bid;
    expect(purpose).toBe("standby");
    const ordinary = signBid(bid, roster.beta);
    expect(decideBid(task, ordinary, { nowMs: close + 500, registry })).toMatchObject({
      ok: false,
      failure: { code: "BID_WINDOW_CLOSED" },
    });
  });

  it("awards an available ordinary bid without waiting for standby", () => {
    const { task, standby, close } = waiting();
    if (task.auction === null) throw new Error("Missing auction");
    const { purpose, ...bid } = standby.bid;
    expect(purpose).toBe("standby");
    const ordinary = signBid(bid, roster.beta);
    const ready = { ...task, auction: { ...task.auction, bids: [ordinary] } };
    expect(decideCloseAuction(ready, { nowMs: close + 1, registry })).toMatchObject({
      ok: true,
      value: [{ type: "recovery_awarded", winner: ordinary.bidHash }, { type: "attempt_assigned" }],
    });
  });

  it.each([
    "absent",
    "expired",
    "excluded",
    "busy",
    "over-budget",
    "wrong-epoch",
    "insufficient-time",
  ] as const)("does not hold for an %s reservation", (kind) => {
    const { task, standby, close } = waiting();
    const changed: TaskRecord = {
      ...task,
      ...(kind === "absent" ? { standby: [] } : {}),
      ...(kind === "excluded" ? { excludedAgents: [roster.beta.agentId] } : {}),
      ...(kind === "expired"
        ? { standby: [signBid({ ...standby.bid, expiresAtMs: close }, roster.beta)] }
        : {}),
      ...(kind === "wrong-epoch"
        ? { standby: [signBid({ ...standby.bid, epoch: task.epoch + 1 }, roster.beta)] }
        : {}),
      ...(kind === "insufficient-time"
        ? { manifest: { ...task.manifest, deadlineMs: close + 500 } }
        : {}),
      ...(kind === "over-budget"
        ? {
            standby: [
              signBid(
                {
                  ...standby.bid,
                  amountYocto: toYocto(near("0.66")),
                  members: standby.bid.members.map((member) => ({
                    ...member,
                    shareYocto: toYocto(near("0.66")),
                  })),
                },
                roster.beta,
              ),
            ],
          }
        : {}),
    };
    const context = {
      nowMs: close + 1,
      registry,
      ...(kind === "busy" ? { busyAgents: new Set([roster.beta.agentId]) } : {}),
    };
    expect(decideCloseAuction(changed, context)).toMatchObject({
      ok: true,
      value: [{ type: "terminal_failure", reason: "NO_ELIGIBLE_BIDS" }],
    });
  });

  it("cannot admit an unrelated worker's late readiness through another worker's hold", () => {
    const { task, close } = waiting();
    expect(
      decideConfirmStandby(task, roster.gamma.agentId, task.epoch, {
        nowMs: close + 500,
        registry,
      }),
    ).toMatchObject({ ok: false, failure: { code: "BID_WINDOW_CLOSED" } });
  });
});
