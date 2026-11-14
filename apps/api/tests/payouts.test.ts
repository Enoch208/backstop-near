import { describe, expect, it } from "vitest";
import { asPrincipal, endorseBid, principals, roster, signBid } from "@backstop/agents";
import { candidate, checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import type { QuoteRequest } from "@backstop/near";
import { digestOf, near, toYocto } from "@backstop/shared";
import { tick } from "../src/index.js";
import { call, read, testRuntime } from "./support.js";

const taskId = "checkout-intents";

describe("intent-based payouts", () => {
  it("quotes a NEAR Intents route for each payee that asked to be paid in another asset", async () => {
    const { runtime, clock } = testRuntime();
    const asked: QuoteRequest[] = [];
    runtime.intents = {
      refundTo: "backstop-vault.near",
      quote: (request) => {
        asked.push(request);
        return Promise.resolve({
          quote: {
            amountIn: request.amountYocto.toString(),
            amountInFormatted: "0.10",
            amountOut: "331000",
            amountOutFormatted: "0.331",
            amountOutUsd: "0.331",
            minAmountOut: "327000",
            timeEstimate: 14,
          },
          signature: "ed25519:test",
          timestamp: "2026-11-14T12:00:00Z",
          correlationId: "test",
        });
      },
    };
    const fund = (pool: string, amount: string) => ({
      pool,
      amountYocto: toYocto(near(amount)),
      liabilityYocto: null,
    });
    await call(runtime, clock, principals.customer, "/api/tasks", {
      manifest: checkoutManifest({
        taskId,
        createdAtMs: clock.now,
        maxAttempts: 3,
        timing: liveTiming,
      }),
    });
    await call(
      runtime,
      clock,
      principals.customer,
      `/api/tasks/${taskId}/funding`,
      fund("escrow", "0.40"),
    );
    await call(
      runtime,
      clock,
      principals.customer,
      `/api/tasks/${taskId}/funding`,
      fund("premium", "0.04"),
    );
    await call(
      runtime,
      clock,
      principals.guarantor,
      `/api/tasks/${taskId}/funding`,
      fund("bond", "0.25"),
    );
    const coalition = endorseBid(
      signBid(
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
          planHash: digestOf("coalition primary"),
          committedAtMs: clock.now,
          expiresAtMs: clock.now + 60_000,
        },
        roster.gamma,
      ),
      roster.delta,
    );
    const gamma = asPrincipal(roster.gamma);
    await call(runtime, clock, gamma, `/api/tasks/${taskId}/bids`, { bid: coalition });
    await call(runtime, clock, gamma, `/api/tasks/${taskId}/claim`, {});
    await call(runtime, clock, gamma, `/api/tasks/${taskId}/artifacts`, {
      fencingToken: 1,
      source: candidate("gamma-integer").source,
      checkpointHash: null,
    });
    clock.now += liveTiming.challengeWindowMs + 1;
    tick(runtime);
    tick(runtime);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await read(runtime, `/api/tasks/${taskId}`)).body).toMatchObject({
      task: { state: "SETTLED" },
    });
    expect(asked.map((request) => [request.amountYocto, request.preference.label])).toEqual([
      [near("0.10"), "USDC on Base"],
    ]);
    const payouts = await read(runtime, `/api/tasks/${taskId}/payouts`);
    expect(payouts.body).toMatchObject({
      quotes: [
        {
          agentId: "delta",
          wants: "USDC on Base",
          quote: { quote: { amountOutFormatted: "0.331" } },
          error: null,
        },
      ],
    });
  });
});
