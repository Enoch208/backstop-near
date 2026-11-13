import { describe, expect, it } from "vitest";
import {
  bidHash,
  bidSchema,
  digestOf,
  near,
  signValue,
  signingKeyFromSeed,
  toYocto,
  verifyValue,
  type Bid,
} from "../src/index.js";

const coalitionBid: Bid = {
  taskId: "checkout-001",
  epoch: 2,
  members: [
    {
      agentId: "gamma",
      account: "gamma.fixture.testnet",
      role: "repairer",
      shareYocto: toYocto(near("0.40")),
    },
    {
      agentId: "delta",
      account: "delta.fixture.testnet",
      role: "diagnostician",
      shareYocto: toYocto(near("0.12")),
    },
  ],
  amountYocto: toYocto(near("0.52")),
  estimatedDurationMs: 60_000,
  planHash: digestOf("plan"),
  committedAtMs: 1_000,
  expiresAtMs: 90_000,
};

describe("bids", () => {
  it("accepts a coalition whose shares add up to the bid", () => {
    expect(bidSchema.safeParse(coalitionBid).success).toBe(true);
  });

  it("rejects shares that do not add up, and a member named twice", () => {
    const short = { ...coalitionBid, amountYocto: toYocto(near("0.53")) };
    expect(bidSchema.safeParse(short).success).toBe(false);
    const [first] = coalitionBid.members;
    const twice = { ...coalitionBid, members: [first, first], amountYocto: toYocto(near("0.80")) };
    expect(bidSchema.safeParse(twice).success).toBe(false);
  });

  it("binds a signature to the exact bid body", () => {
    const key = signingKeyFromSeed("fixture:gamma");
    const signature = signValue(coalitionBid, key);
    expect(verifyValue(coalitionBid, signature)).toBe(true);
    expect(verifyValue({ ...coalitionBid, amountYocto: toYocto(near("0.60")) }, signature)).toBe(
      false,
    );
    expect(bidHash(coalitionBid)).toBe(digestOf(coalitionBid));
  });
});
