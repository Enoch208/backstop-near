import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ledgerViolations } from "@backstop/ledger";
import { digestOf } from "@backstop/shared";
import { advance, attempt, dueCommands, replay, type Command } from "../src/index.js";
import { assignedTask, record } from "./support.js";

const agents = ["alpha", "beta", "gamma"] as const;

const move = fc.oneof(
  fc.record({ kind: fc.constant("claim" as const), agent: fc.constantFrom(...agents) }),
  fc.record({
    kind: fc.constant("heartbeat" as const),
    agent: fc.constantFrom(...agents),
    token: fc.nat(4),
  }),
  fc.record({
    kind: fc.constant("submit" as const),
    agent: fc.constantFrom(...agents),
    token: fc.nat(4),
  }),
  fc.record({ kind: fc.constant("wait" as const), ms: fc.integer({ min: 1_000, max: 40_000 }) }),
  fc.record({ kind: fc.constant("keep" as const) }),
);

function commandFor(step: { kind: string; agent?: string; token?: number }): Command | null {
  const agentId = step.agent ?? "alpha";
  const fencingToken = step.token ?? 0;
  if (step.kind === "claim") return { kind: "claim", agentId };
  if (step.kind === "heartbeat") return { kind: "heartbeat", agentId, fencingToken };
  if (step.kind === "submit") {
    return {
      kind: "submit",
      agentId,
      fencingToken,
      artifactHash: digestOf(agentId),
      checkpointHash: null,
    };
  }
  return null;
}

describe("orchestrator invariants", () => {
  it("keeps at most one fenced lease, monotonic tokens, a sound ledger and a replayable log under random storms", () => {
    fc.assert(
      fc.property(fc.array(move, { maxLength: 40 }), (moves) => {
        const driver = assignedTask("checkout-storm");
        let lastToken = 0;
        for (const step of moves) {
          if (step.kind === "wait") advance(driver, step.ms);
          if (step.kind === "keep") {
            for (const command of dueCommands(record(driver), driver.nowMs))
              attempt(driver, "keeper", command, "keep");
          }
          const command = commandFor(step);
          if (command !== null) attempt(driver, "agent", command, "storm");
          const current = record(driver);
          expect(current.fencingToken).toBeGreaterThanOrEqual(lastToken);
          lastToken = current.fencingToken;
          if (current.lease !== null) expect(current.lease.fencingToken).toBe(current.fencingToken);
          expect(ledgerViolations(current.ledger)).toEqual([]);
        }
        expect(replay(driver.store.streams[driver.taskId] ?? [])).toEqual(record(driver));
      }),
      { numRuns: 150, seed: 1_114 },
    );
  });
});
