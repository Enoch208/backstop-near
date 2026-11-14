import { describe, expect, it } from "vitest";
import {
  arenaCase,
  baseline,
  retryBaseline,
  runArenaCase,
  type ArenaOutcome,
} from "../src/index.js";

const rank: Readonly<Record<ArenaOutcome, number>> = {
  "delivered-correct": 3,
  compensated: 2,
  refunded: 1,
  "delivered-wrong": 0,
};

const seeds = Array.from({ length: 32 }, (_, index) => index + 1);

describe("the reliability arena", () => {
  const rows = seeds.map((seed) => {
    const setup = arenaCase(seed);
    return {
      setup,
      backstop: runArenaCase(setup, "backstop"),
      single: runArenaCase(baseline(setup), "single"),
      retries: runArenaCase(retryBaseline(setup), "retries"),
    };
  });

  it("keeps every ledger invariant and replays every task exactly, in every seeded case", () => {
    for (const { backstop, single, retries } of rows) {
      for (const result of [backstop, single, retries]) {
        expect(result.violations).toEqual([]);
        expect(result.replayMatches).toBe(true);
        expect(["SETTLED", "FAILURE_SETTLED"]).toContain(result.state);
      }
    }
  });

  it("never ships a wrong patch while a challenger is present", () => {
    const challenged = rows.filter(({ setup }) => setup.challenger);
    expect(challenged.length).toBeGreaterThan(0);
    expect(challenged.every(({ backstop }) => backstop.outcome !== "delivered-wrong")).toBe(true);
  });

  it("never leaves a customer worse off than a single agent, with or without retries", () => {
    for (const { setup, backstop, single, retries } of rows) {
      expect({
        seed: setup.seed,
        single: rank[backstop.outcome] >= rank[single.outcome],
        retries: rank[backstop.outcome] >= rank[retries.outcome],
      }).toEqual({ seed: setup.seed, single: true, retries: true });
    }
  });

  it("lets the retry baseline spend the whole attempt cap when its primary dies", () => {
    const killed = rows.filter(({ setup }) => setup.fate === "dies");
    expect(killed.some(({ setup }) => setup.maxAttempts > 1)).toBe(true);
    for (const { setup, single, retries } of killed) {
      expect({ seed: setup.seed, single: single.attempts, retries: retries.attempts }).toEqual({
        seed: setup.seed,
        single: 1,
        retries: setup.maxAttempts,
      });
    }
  });

  it("gains nothing from retries alone, because every scripted fault is bound to its agent", () => {
    for (const { setup, single, retries } of rows) {
      expect({ seed: setup.seed, outcome: retries.outcome }).toEqual({
        seed: setup.seed,
        outcome: single.outcome,
      });
    }
  });

  it("makes a customer whole, or better, whenever the work is not delivered", () => {
    const undelivered = rows.filter(
      ({ backstop }) => backstop.outcome === "compensated" || backstop.outcome === "refunded",
    );
    expect(undelivered.length).toBeGreaterThan(0);
    for (const { backstop } of undelivered)
      expect(backstop.customerReceived >= backstop.customerPaid).toBe(true);
  });
});
