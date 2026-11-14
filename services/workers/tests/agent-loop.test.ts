import { describe, expect, it } from "vitest";
import { fixtureBids, roster, type FixtureAgent, type ModelConfig } from "@backstop/agents";
import {
  candidate,
  checkoutManifest,
  liveTiming,
  type CandidateName,
} from "@backstop/fixture-checkout";
import {
  checkpointHash,
  findingHash,
  findingSchema,
  near,
  toYocto,
  type FailureReason,
  type Json,
} from "@backstop/shared";
import { z } from "zod";
import { agentLoop } from "../src/agent-loop.js";
import type { ApiClient } from "../src/client.js";

const taskId = "checkout-loop";
const findingPostSchema = z.object({ attempt: z.int(), finding: findingSchema });

type FakeMarket = {
  readonly excludedAgents?: string[];
  readonly failures?: FailureReason[];
  readonly checkpoint?: CandidateName;
  readonly served?: string;
  readonly routes?: Record<string, unknown>;
};

function fakeClient(market: FakeMarket = {}) {
  const posts: { path: string; body: Json }[] = [];
  const leased = { events: [{ body: { type: "lease_granted", lease: { fencingToken: 2 } } }] };
  const manifest = checkoutManifest({ taskId, createdAtMs: 0, maxAttempts: 3, timing: liveTiming });
  const resumed = market.checkpoint === undefined ? null : candidate(market.checkpoint);
  const checkpoint =
    resumed === null
      ? null
      : {
          taskId,
          attempt: 1,
          stateVersion: 7,
          contentHash: resumed.artifactHash,
          artifactUri: `fixture://checkout/candidates/${resumed.name}.js`,
          validatedSubtasks: ["discount-before-tax"],
          provenanceEventIds: [`${taskId}#7`],
          parentCheckpointHash: null,
        };
  const task = {
    state: "RECOVERY_OPEN",
    version: 9,
    attempt: 2,
    manifest: { ...manifest, deadlineMs: Date.now() + 30 * 60_000 },
    excludedAgents: market.excludedAgents ?? [],
    checkpoints: checkpoint === null ? [] : [{ checkpoint, hash: checkpointHash(checkpoint) }],
    failures: (market.failures ?? []).map((reason, index) => ({ attempt: index + 1, reason })),
    ledger: {
      available: {
        escrow: toYocto(near("0.40")),
        premium: toYocto(near("0.04")),
        bond: toYocto(near("0.25")),
      },
      maxBondLiability: toYocto(near("0.25")),
      bondConsumed: "0",
    },
  };
  const client: ApiClient = {
    post: (path, body) => {
      posts.push({ path, body });
      return Promise.resolve({
        status: 200,
        body: path.endsWith("/claim") ? leased : { events: [] },
      });
    },
    get: (path) =>
      Promise.resolve({
        status: 200,
        body:
          market.routes?.[path] ??
          (path.includes("/artifacts/") && resumed !== null
            ? { artifactHash: resumed.artifactHash, source: market.served ?? resumed.source }
            : { task }),
      }),
    follow: () => Promise.resolve(),
  };
  return { client, posts };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function loopFor(agent: FixtureAgent, market: FakeMarket = {}, model: ModelConfig | null = null) {
  const fake = fakeClient(market);
  const lines: string[] = [];
  const onEvent = agentLoop(
    agent,
    fake.client,
    taskId,
    (line) => lines.push(line),
    () => undefined,
    model,
  );
  return { onEvent, ...fake, lines };
}

const event = (version: number, body: Record<string, unknown>) => ({ taskId, version, body });

const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 100 && !check(); tries += 1) await settle();
};

const coalitionBid = () => {
  const [, coalition] = fixtureBids({
    taskId,
    epoch: 1,
    nowMs: 0,
    bidWindowMs: 1_000,
    excludedAgents: [],
  });
  if (coalition === undefined) throw new Error("expected the coalition bid");
  return coalition;
};

describe("the agent loop", () => {
  it("lets its lease lapse instead of holding it when the model call fails", async () => {
    const unreachable = { baseUrl: "http://127.0.0.1:9", apiKey: "test", model: "test/model" };
    const beta = loopFor(roster.beta, {}, unreachable);
    beta.onEvent(
      event(17, {
        type: "attempt_assigned",
        attempt: 2,
        epoch: 1,
        bid: fixtureBids({ taskId, epoch: 1, nowMs: 0, bidWindowMs: 1, excludedAgents: [] })[0],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(beta.lines).toContain(
      "stopped heartbeats so the lease expires and the work is re-auctioned",
    );
    expect(beta.posts.filter((post) => post.path.endsWith("/heartbeat"))).toEqual([]);
  });

  it("lets only the executor offer itself as the primary once the guarantee is posted", async () => {
    const alpha = loopFor(roster.alpha);
    const beta = loopFor(roster.beta);
    alpha.onEvent(event(4, { type: "guarantee_posted" }));
    beta.onEvent(event(4, { type: "guarantee_posted" }));
    await settle();
    expect(alpha.posts.map((post) => post.path)).toEqual([`/api/tasks/${taskId}/bids`]);
    expect(beta.posts).toEqual([]);
  });

  it("bids once per recovery epoch, even when the event is delivered twice", async () => {
    const gamma = loopFor(roster.gamma, {
      checkpoint: "alpha-partial",
      failures: ["LEASE_EXPIRED"],
    });
    gamma.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    gamma.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    await settle();
    expect(gamma.posts).toHaveLength(1);
    expect(gamma.posts[0]?.body).toMatchObject({
      bid: { bid: { epoch: 1, members: [{ agentId: "gamma" }, { agentId: "delta" }] } },
    });
  });

  it("prices its bid from the checkpoint it would resume and logs why", async () => {
    const market: FakeMarket = { checkpoint: "alpha-partial", failures: ["LEASE_EXPIRED"] };
    const beta = loopFor(roster.beta, market);
    const gamma = loopFor(roster.gamma, market);
    beta.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    gamma.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    await settle();
    expect(beta.posts[0]?.body).toMatchObject({
      bid: { bid: { amountYocto: toYocto(near("0.25")), estimatedDurationMs: 40_000 } },
    });
    expect(gamma.posts[0]?.body).toMatchObject({
      bid: {
        bid: {
          amountYocto: toYocto(near("0.60")),
          members: [
            { agentId: "gamma", shareYocto: toYocto(near("0.40")) },
            { agentId: "delta", shareYocto: toYocto(near("0.20")) },
          ],
        },
      },
    });
    expect(beta.lines).toEqual([
      "pricing: epoch 1: 1 failed attempt so far (LEASE_EXPIRED +25%), risk loading 25%",
      "pricing: latest checkpoint fails 1 of 4 public cases: 2 units of work (one per failing case, one to re-check the hidden rules)",
      "pricing: beta (repairer): floor 0.1 NEAR/unit × 2 = 0.2 NEAR, +25% = 0.25 NEAR",
      "pricing: bids 0.25 NEAR of the 0.65 NEAR left in escrow plus liability",
      "bid 0.25 NEAR for epoch 1 (HTTP 200)",
    ]);
  });

  it("declines to bid, and posts nothing, when the risk is above its appetite", async () => {
    const epsilon = loopFor(roster.epsilon, {
      checkpoint: "beta-boundary",
      failures: ["LEASE_EXPIRED", "CHALLENGE_UPHELD"],
    });
    epsilon.onEvent(event(20, { type: "recovery_opened", epoch: 2 }));
    await settle();
    expect(epsilon.posts).toEqual([]);
    expect(epsilon.lines.at(-1)).toBe(
      "pricing: declines: 125% risk is above epsilon's 50% appetite",
    );
  });

  it("prices the original source when the checkpoint it fetched was altered", async () => {
    const beta = loopFor(roster.beta, {
      checkpoint: "alpha-partial",
      served: candidate("original").source.replace("checkoutTotal", "checkoutTotal "),
      failures: ["LEASE_EXPIRED"],
    });
    beta.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    await settle();
    expect(beta.lines[0]).toMatch(/is unavailable or altered; starting fresh$/);
    expect(beta.lines).toContain(
      "pricing: latest checkpoint fails 2 of 4 public cases: 3 units of work (one per failing case, one to re-check the hidden rules)",
    );
    expect(beta.posts[0]?.body).toMatchObject({
      bid: { bid: { amountYocto: toYocto(near("0.375")) } },
    });
  });

  it("declines when the whole job from the original source costs more than is left", async () => {
    const gamma = loopFor(roster.gamma);
    gamma.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    await settle();
    expect(gamma.posts).toEqual([]);
    expect(gamma.lines.at(-1)).toBe(
      "pricing: declines: its floor of 0.72 NEAR is above the 0.65 NEAR left in escrow plus liability",
    );
  });

  it("stays out of a market that has excluded it", async () => {
    const beta = loopFor(roster.beta, { excludedAgents: ["beta"] });
    beta.onEvent(event(22, { type: "recovery_opened", epoch: 2 }));
    await settle();
    expect(beta.posts).toEqual([]);
  });

  it("claims only an assignment whose winning bid it leads", async () => {
    const [betaBid] = fixtureBids({
      taskId,
      epoch: 1,
      nowMs: 0,
      bidWindowMs: 1_000,
      excludedAgents: [],
    });
    const gamma = loopFor(roster.gamma);
    const beta = loopFor(roster.beta);
    const assigned = event(15, { type: "attempt_assigned", attempt: 2, epoch: 1, bid: betaBid });
    gamma.onEvent(assigned);
    beta.onEvent(assigned);
    await settle();
    expect(gamma.posts).toEqual([]);
    expect(beta.posts.map((post) => post.path)).toEqual([`/api/tasks/${taskId}/claim`]);
  });

  it("co-signs a coalition seat that meets its own price, and only its own seat", async () => {
    const [, coalition] = fixtureBids({
      taskId,
      epoch: 1,
      nowMs: 0,
      bidWindowMs: 1_000,
      excludedAgents: [],
    });
    const delta = loopFor(roster.delta);
    const epsilon = loopFor(roster.epsilon);
    const proposed = event(12, { type: "coalition_proposed", bid: coalition });
    delta.onEvent(proposed);
    epsilon.onEvent(proposed);
    await settle();
    expect(delta.posts.map((post) => post.path)).toEqual([`/api/tasks/${taskId}/endorsements`]);
    expect(delta.posts[0]?.body).toMatchObject({
      bidHash: coalition?.bidHash,
      signature: { scheme: "ed25519" },
    });
    expect(epsilon.posts).toEqual([]);
  });

  it("ignores events it does not understand", () => {
    const alpha = loopFor(roster.alpha);
    expect(() => {
      alpha.onEvent({ nonsense: true });
      alpha.onEvent(event(3, { type: "funds_deposited" }));
    }).not.toThrow();
  });

  it("has a diagnostician seat post a finding on the code its lead will repair, without claiming", async () => {
    const delta = loopFor(roster.delta);
    delta.onEvent(
      event(15, { type: "attempt_assigned", attempt: 2, epoch: 1, bid: coalitionBid() }),
    );
    await until(() => delta.posts.length > 0);
    expect(delta.posts.map((post) => post.path)).toEqual([`/api/tasks/${taskId}/findings`]);
    const posted = findingPostSchema.parse(delta.posts[0]?.body);
    expect(posted.attempt).toBe(2);
    expect(posted.finding.failingCases.map((failing) => failing.id)).toEqual(
      expect.arrayContaining(["discount-before-tax", "half-cent-tax-rounds-up"]),
    );
  });

  it("has the lead wait for its partner's finding, check its hash and repair with it", async () => {
    const finding = { failingCases: [], notes: "4 of 4 public cases pass" };
    const hash = findingHash(finding);
    const gamma = loopFor(roster.gamma, {
      routes: { [`/api/tasks/${taskId}/findings/${hash}`]: { findingHash: hash, finding } },
    });
    gamma.onEvent(
      event(15, { type: "attempt_assigned", attempt: 2, epoch: 1, bid: coalitionBid() }),
    );
    gamma.onEvent(
      event(16, { type: "finding_recorded", attempt: 2, agentId: "delta", findingHash: hash }),
    );
    await until(() => gamma.lines.some((line) => line.startsWith("consumed")));
    expect(gamma.lines).toContain(
      `consumed delta's finding ${hash.slice(0, 19)}… (hash verified), failing cases: none`,
    );
  });

  it("has the lead repair alone when the posted finding was altered", async () => {
    const finding = { failingCases: [], notes: "the honest note" };
    const hash = findingHash(finding);
    const gamma = loopFor(roster.gamma, {
      routes: {
        [`/api/tasks/${taskId}/findings/${hash}`]: {
          findingHash: hash,
          finding: { ...finding, notes: "a swapped note" },
        },
      },
    });
    gamma.onEvent(
      event(15, { type: "attempt_assigned", attempt: 2, epoch: 1, bid: coalitionBid() }),
    );
    gamma.onEvent(
      event(16, { type: "finding_recorded", attempt: 2, agentId: "delta", findingHash: hash }),
    );
    await until(() => gamma.lines.some((line) => line.includes("altered")));
    expect(gamma.lines).toContain(
      "delta's finding is unavailable or altered; repairing without it",
    );
  });
});
