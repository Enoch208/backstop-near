import { describe, expect, it } from "vitest";
import { asPrincipal, endorseBid, roster, signBid } from "@backstop/agents";
import { candidate } from "@backstop/fixture-checkout";
import { findingHash, near, toYocto, type Finding } from "@backstop/shared";
import { bondedTask, call, read } from "./support.js";

const taskId = "checkout-findings";
const base = `/api/tasks/${taskId}`;

const finding: Finding = {
  failingCases: [
    {
      id: "half-cent-tax-rounds-up",
      input: { lines: [] },
      expected: { totalCents: 1 },
      actual: { totalCents: 0 },
    },
  ],
  notes: "tax rounds half down",
};

async function coalitionPrimary() {
  const task = await bondedTask(taskId);
  const signed = signBid(
    {
      taskId,
      epoch: 0,
      members: [
        {
          agentId: "gamma",
          account: roster.gamma.account,
          role: "repairer",
          shareYocto: toYocto(near("0.20")),
        },
        {
          agentId: "delta",
          account: roster.delta.account,
          role: "diagnostician",
          shareYocto: toYocto(near("0.10")),
        },
      ],
      amountYocto: toYocto(near("0.30")),
      estimatedDurationMs: 60_000,
      planHash: candidate("original").artifactHash,
      committedAtMs: task.clock.now,
      expiresAtMs: task.clock.now + 60_000,
    },
    roster.gamma,
  );
  const bid = endorseBid(signed, roster.delta);
  const assigned = await call(task.runtime, task.clock, asPrincipal(roster.gamma), `${base}/bids`, {
    bid,
  });
  expect(assigned.status).toBe(200);
  return task;
}

describe("diagnostic findings over the API", () => {
  it("stores a coalition member's signed finding by its digest and serves it back", async () => {
    const { runtime, clock } = await coalitionPrimary();
    const posted = await call(runtime, clock, asPrincipal(roster.delta), `${base}/findings`, {
      attempt: 1,
      finding,
    });
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({
      events: [
        {
          actor: "delta",
          body: {
            type: "finding_recorded",
            attempt: 1,
            agentId: "delta",
            findingHash: findingHash(finding),
            failingCases: ["half-cent-tax-rounds-up"],
          },
        },
      ],
    });
    const served = await read(runtime, `${base}/findings/${findingHash(finding)}`);
    expect(served).toEqual({
      status: 200,
      body: { findingHash: findingHash(finding), finding },
    });
  });

  it("refuses a non-member and a second finding, and stores nothing it refused", async () => {
    const { runtime, clock } = await coalitionPrimary();
    const outsider = { ...finding, notes: "an outsider's guess" };
    const refused = await call(runtime, clock, asPrincipal(roster.beta), `${base}/findings`, {
      attempt: 1,
      finding: outsider,
    });
    expect(refused.status).toBe(403);
    expect((await read(runtime, `${base}/findings/${findingHash(outsider)}`)).status).toBe(404);
    const post = (body: Finding) =>
      call(runtime, clock, asPrincipal(roster.delta), `${base}/findings`, {
        attempt: 1,
        finding: body,
      });
    expect((await post(finding)).status).toBe(201);
    const again = await post({ ...finding, notes: "second opinion" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: "DUPLICATE" } });
  });

  it("refuses a malformed finding and a finding for another attempt", async () => {
    const { runtime, clock } = await coalitionPrimary();
    const delta = asPrincipal(roster.delta);
    const malformed = await call(runtime, clock, delta, `${base}/findings`, {
      attempt: 1,
      finding: { failingCases: [{ id: "Not An Id" }], notes: "" },
    });
    expect(malformed.status).toBe(400);
    const stale = await call(runtime, clock, delta, `${base}/findings`, { attempt: 2, finding });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: "STALE_STATE" } });
  });
});
