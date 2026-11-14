import { describe, expect, it } from "vitest";
import { decideToJoin, endorsement, fixtureBids, roster, signBid } from "@backstop/agents";
import { near, toYocto } from "@backstop/shared";
import { advance, run } from "../src/index.js";
import { assignedTask, record, refusal } from "./support.js";

function openMarket() {
  const driver = assignedTask();
  advance(driver, 30_001);
  run(driver, "keeper", { kind: "expireLease" }, "expire");
  const proposals = fixtureBids({
    taskId: driver.taskId,
    epoch: 1,
    nowMs: driver.nowMs,
    bidWindowMs: 10_000,
    excludedAgents: [],
  });
  const coalition = proposals.find((signed) => signed.bid.members.length > 1);
  if (coalition === undefined) throw new Error("expected a coalition proposal");
  return { driver, coalition };
}

describe("coalition formation", () => {
  it("records a lead's coalition as a proposal until every member co-signs its seat", () => {
    const { driver, coalition } = openMarket();
    const proposed = run(driver, "gamma", { kind: "bid", bid: coalition }, "propose");
    expect(proposed.events.map((event) => event.body.type)).toEqual(["coalition_proposed"]);
    expect(record(driver).auction?.bids).toEqual([]);
    const endorsed = run(
      driver,
      "delta",
      {
        kind: "endorse",
        bidHash: coalition.bidHash,
        endorsement: endorsement(coalition, roster.delta),
      },
      "endorse",
    );
    expect(endorsed.events.map((event) => event.body.type)).toEqual([
      "coalition_endorsed",
      "bid_submitted",
    ]);
    expect(record(driver).auction).toMatchObject({
      proposals: [],
      bids: [{ bidHash: coalition.bidHash }],
    });
  });

  it("refuses an endorsement signed by anyone but the named member, a second one, and a late one", () => {
    const { driver, coalition } = openMarket();
    run(driver, "gamma", { kind: "bid", bid: coalition }, "propose");
    const forged = {
      agentId: "delta",
      signature: endorsement(coalition, roster.epsilon).signature,
    };
    expect(
      refusal(driver, "epsilon", {
        kind: "endorse",
        bidHash: coalition.bidHash,
        endorsement: forged,
      }),
    ).toBe("BAD_SIGNATURE");
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
    expect(
      refusal(driver, "delta", {
        kind: "endorse",
        bidHash: coalition.bidHash,
        endorsement: endorsement(coalition, roster.delta),
      }),
    ).toBe("NOT_FOUND");
    const { driver: late, coalition: lateCoalition } = openMarket();
    run(late, "gamma", { kind: "bid", bid: lateCoalition }, "propose");
    advance(late, 10_001);
    expect(
      refusal(late, "delta", {
        kind: "endorse",
        bidHash: lateCoalition.bidHash,
        endorsement: endorsement(lateCoalition, roster.delta),
      }),
    ).toBe("BID_WINDOW_CLOSED");
  });

  it("refuses a coalition bid that carries a forged member endorsement", () => {
    const { driver, coalition } = openMarket();
    const forged = {
      ...coalition,
      endorsements: [
        { agentId: "delta", signature: endorsement(coalition, roster.gamma).signature },
      ],
    };
    expect(refusal(driver, "gamma", { kind: "bid", bid: forged })).toBe("BAD_SIGNATURE");
  });

  it("never lets an unendorsed coalition win, however cheap", () => {
    const { driver, coalition } = openMarket();
    const cheap = signBid(
      {
        ...coalition.bid,
        amountYocto: toYocto(near("0.20")),
        members: coalition.bid.members.map((member) => ({
          ...member,
          shareYocto: toYocto(near("0.10")),
        })),
      },
      roster.gamma,
    );
    run(driver, "gamma", { kind: "bid", bid: cheap }, "propose");
    advance(driver, 10_001);
    run(driver, "keeper", { kind: "closeAuction" }, "close");
    expect(record(driver).state).toBe("TERMINAL_FAILURE");
  });

  it("lets delta decide for itself: it declines a seat below its price or beside a failed agent", () => {
    const { coalition } = openMarket();
    expect(decideToJoin(roster.delta, coalition, [])).toMatchObject({ join: true });
    const lowball = signBid(
      {
        ...coalition.bid,
        amountYocto: toYocto(near("0.45")),
        members: coalition.bid.members.map((member) => ({
          ...member,
          shareYocto: toYocto(member.agentId === "delta" ? near("0.05") : near("0.40")),
        })),
      },
      roster.gamma,
    );
    expect(decideToJoin(roster.delta, lowball, [])).toMatchObject({ join: false });
    expect(decideToJoin(roster.delta, coalition, ["gamma"])).toMatchObject({ join: false });
    expect(decideToJoin(roster.epsilon, coalition, [])).toMatchObject({ join: false });
  });
});
