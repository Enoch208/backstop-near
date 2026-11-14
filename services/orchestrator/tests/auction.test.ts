import { describe, expect, it } from "vitest";
import { endorseBid, fixtureBids, roster, signBid } from "@backstop/agents";
import { digestOf, near, toYocto, type SignedBid, type TaskManifest } from "@backstop/shared";
import { advance, run, runAuction } from "../src/index.js";
import { preferredRecoveryStrategy } from "../src/core/recovery-routing.js";
import { assignedTask, record, refusal } from "./support.js";

function recoveryOpen() {
  const driver = assignedTask();
  advance(driver, 30_001);
  run(driver, "keeper", { kind: "expireLease" }, "expire");
  return driver;
}

const proposalsFor = (driver: ReturnType<typeof recoveryOpen>) =>
  fixtureBids({
    taskId: driver.taskId,
    epoch: 1,
    nowMs: driver.nowMs,
    bidWindowMs: 10_000,
    excludedAgents: [],
  });

const bidsFor = (driver: ReturnType<typeof recoveryOpen>) =>
  proposalsFor(driver).map((signed) =>
    signed.bid.members.length > 1 ? endorseBid(signed, roster.delta) : signed,
  );

describe("the recovery auction", () => {
  it("does not pay a rebuild premium based on a strategy label, even after rejection", () => {
    const driver = recoveryOpen();
    const task = record(driver);
    const [patch, coalition, overBudget] = bidsFor(driver);
    if (patch === undefined || coalition === undefined || overBudget === undefined)
      throw new Error("expected three signed bids");
    const rebuild = endorseBid(
      signBid({ ...coalition.bid, strategy: "rebuild" }, roster.gamma),
      roster.delta,
    );
    const expensive = signBid({ ...overBudget.bid, strategy: "rebuild" }, roster.epsilon);
    const manifest: TaskManifest = {
      ...task.manifest,
      policy: { ...task.manifest.policy, recoveryStrategy: "patch" },
    };
    const rejected = {
      ...task,
      manifest,
      failures: [{ attempt: 1, reason: "VERDICT_REJECTED" }] as const,
      recoveryFeedback: [
        {
          attempt: 1,
          artifactHash: digestOf("rejected patch"),
          publicFailedCaseIds: [],
          heldOutFailures: 1,
          executionErrors: 0,
        },
      ],
    };
    expect(preferredRecoveryStrategy({ ...task, manifest })).toBe("patch");
    const strategy = preferredRecoveryStrategy(rejected);
    expect(strategy).toBe("rebuild");
    const quotes = [patch, rebuild, expensive];
    const select = (excluded: string[], fixed?: readonly string[]) =>
      runAuction(quotes, task.ledger, driver.nowMs, excluded, fixed, strategy).winner?.bidHash;
    expect(select([])).toBe(patch.bidHash);
    expect(select(["gamma"])).toBe(patch.bidHash);
    expect(select(["beta"])).toBe(rebuild.bidHash);
    expect(select([], ["beta", "gamma", "epsilon"])).toBe(patch.bidHash);
  });

  it("uses strategy preference only between equally priced eligible bids", () => {
    const driver = recoveryOpen();
    const [cheap] = bidsFor(driver);
    if (cheap === undefined) throw new Error("expected bids");
    const patch = signBid({ ...cheap.bid, strategy: "patch" }, roster.beta);
    const rebuild = signBid(
      { ...cheap.bid, strategy: "rebuild", committedAtMs: cheap.bid.committedAtMs + 1 },
      roster.beta,
    );
    expect(
      runAuction([patch, rebuild], record(driver).ledger, driver.nowMs, [], undefined, "rebuild")
        .winner?.bidHash,
    ).toBe(rebuild.bidHash);
    expect(
      runAuction([patch, rebuild], record(driver).ledger, driver.nowMs, []).winner?.bidHash,
    ).toBe(patch.bidHash);
  });

  it("TC-007 awards exactly one winner by price and records why the rest lost", () => {
    const driver = recoveryOpen();
    for (const bid of bidsFor(driver)) run(driver, "agent", { kind: "bid", bid }, "bid");
    advance(driver, 10_001);
    const step = run(driver, "keeper", { kind: "closeAuction" }, "close");
    const award = step.events[0]?.body;
    expect(award?.type).toBe("recovery_awarded");
    expect(record(driver).assignment?.bid.bid.members[0]?.agentId).toBe("beta");
    expect(
      award?.type === "recovery_awarded" ? award.rejected.map((rejected) => rejected.reason) : [],
    ).toEqual(["over the remaining recovery budget", "outbid"]);
    expect(record(driver).ledger.transfers).toEqual([]);
  });

  it("breaks price ties by the earlier commitment, then by bid hash", () => {
    const driver = recoveryOpen();
    const [cheap] = bidsFor(driver);
    if (cheap === undefined) throw new Error("expected bids");
    const later: SignedBid = signBid(
      { ...cheap.bid, committedAtMs: cheap.bid.committedAtMs + 5 },
      roster.beta,
    );
    const ledger = record(driver).ledger;
    expect(runAuction([later, cheap], ledger, driver.nowMs, []).winner?.bidHash).toBe(
      cheap.bidHash,
    );
  });

  it("refuses forged, duplicate, late and excluded bids", () => {
    const driver = recoveryOpen();
    const [beta, coalition] = bidsFor(driver);
    if (beta === undefined || coalition === undefined) throw new Error("expected bids");
    const forged = {
      ...beta,
      bid: {
        ...beta.bid,
        amountYocto: toYocto(near("0.29")),
        members: [{ ...beta.bid.members[0], shareYocto: toYocto(near("0.29")) }],
      },
    } as SignedBid;
    expect(refusal(driver, "beta", { kind: "bid", bid: forged })).toBe("BAD_SIGNATURE");
    const stolen = signBid(coalition.bid, roster.epsilon);
    expect(refusal(driver, "epsilon", { kind: "bid", bid: stolen })).toBe("BAD_SIGNATURE");
    run(driver, "beta", { kind: "bid", bid: beta }, "bid");
    expect(refusal(driver, "beta", { kind: "bid", bid: beta })).toBe("DUPLICATE");
    const alpha = signBid(
      {
        ...beta.bid,
        members: [
          {
            agentId: "alpha",
            account: roster.alpha.account,
            role: "repairer",
            shareYocto: beta.bid.amountYocto,
          },
        ],
      },
      roster.alpha,
    );
    expect(refusal(driver, "alpha", { kind: "bid", bid: alpha })).toBe("POLICY_VIOLATION");
    advance(driver, 10_001);
    expect(refusal(driver, "gamma", { kind: "bid", bid: coalition })).toBe("BID_WINDOW_CLOSED");
  });

  it("ends in terminal failure when no eligible bid arrives", () => {
    const driver = recoveryOpen();
    advance(driver, 10_001);
    run(driver, "keeper", { kind: "closeAuction" }, "close");
    expect(record(driver).state).toBe("TERMINAL_FAILURE");
  });
});
