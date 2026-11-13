import { describe, expect, it } from "vitest";
import { fixtureBids, roster, type FixtureAgent } from "@backstop/agents";
import { checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import type { Json } from "@backstop/shared";
import { agentLoop } from "../src/agent-loop.js";
import type { ApiClient } from "../src/client.js";

const taskId = "checkout-loop";

function fakeClient(excludedAgents: string[] = []) {
  const posts: { path: string; body: Json }[] = [];
  const manifest = checkoutManifest({ taskId, createdAtMs: 0, maxAttempts: 3, timing: liveTiming });
  const client: ApiClient = {
    post: (path, body) => {
      posts.push({ path, body });
      return Promise.resolve({ status: 200, body: { events: [] } });
    },
    get: () =>
      Promise.resolve({
        status: 200,
        body: {
          task: {
            state: "RECOVERY_OPEN",
            version: 9,
            attempt: 1,
            manifest,
            excludedAgents,
            checkpoints: [],
          },
        },
      }),
    follow: () => Promise.resolve(),
  };
  return { client, posts };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function loopFor(agent: FixtureAgent, excluded: string[] = []) {
  const fake = fakeClient(excluded);
  const lines: string[] = [];
  const onEvent = agentLoop(
    agent,
    fake.client,
    taskId,
    (line) => lines.push(line),
    () => undefined,
  );
  return { onEvent, ...fake, lines };
}

const event = (version: number, body: Record<string, unknown>) => ({ taskId, version, body });

describe("the agent loop", () => {
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
    const gamma = loopFor(roster.gamma);
    gamma.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    gamma.onEvent(event(10, { type: "recovery_opened", epoch: 1 }));
    await settle();
    expect(gamma.posts).toHaveLength(1);
    expect(gamma.posts[0]?.body).toMatchObject({
      bid: { bid: { epoch: 1, members: [{ agentId: "gamma" }, { agentId: "delta" }] } },
    });
  });

  it("stays out of a market that has excluded it", async () => {
    const beta = loopFor(roster.beta, ["beta"]);
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

  it("ignores events it does not understand", () => {
    const alpha = loopFor(roster.alpha);
    expect(() => {
      alpha.onEvent({ nonsense: true });
      alpha.onEvent(event(3, { type: "funds_deposited" }));
    }).not.toThrow();
  });
});
