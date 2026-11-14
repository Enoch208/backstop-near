import { describe, expect, it } from "vitest";
import {
  ablate,
  arenaCase,
  baseline,
  retryBaseline,
  runArenaCase,
  type ArenaCase,
  type ArenaOutcome,
} from "../src/index.js";

const rank: Readonly<Record<ArenaOutcome, number>> = {
  "delivered-correct": 3,
  compensated: 2,
  refunded: 1,
  "delivered-wrong": 0,
};

const modes = {
  backstop: (setup: ArenaCase) => setup,
  single: baseline,
  retries: retryBaseline,
  ...ablate,
};

const seeds = Array.from({ length: 32 }, (_, index) => index + 1);

describe("the reliability arena", () => {
  const rows = seeds.map((seed) => {
    const setup = arenaCase(seed);
    const results = Object.fromEntries(
      Object.entries(modes).map(([mode, configure]) => [
        mode,
        runArenaCase(configure(setup), mode),
      ]),
    );
    const result = (mode: keyof typeof modes) => {
      const found = results[mode];
      if (found === undefined) throw new Error(`No ${mode} result for seed ${String(seed)}`);
      return found;
    };
    return { setup, results, result };
  });

  it("keeps every ledger invariant and replays every task exactly, in every mode and case", () => {
    for (const { results } of rows) {
      for (const result of Object.values(results)) {
        expect(result.violations).toEqual([]);
        expect(result.replayMatches).toBe(true);
        expect(["SETTLED", "FAILURE_SETTLED"]).toContain(result.state);
      }
    }
  });

  it("never ships a wrong patch while a challenger is present, even without the market or bond", () => {
    const challenged = rows.filter(({ setup }) => setup.challenger);
    expect(challenged.length).toBeGreaterThan(0);
    for (const { setup, result } of challenged) {
      for (const mode of ["backstop", "no-market", "no-bond"] as const) {
        expect({ seed: setup.seed, mode, outcome: result(mode).outcome }).not.toEqual({
          seed: setup.seed,
          mode,
          outcome: "delivered-wrong",
        });
      }
    }
  });

  it("never leaves a customer worse off than any baseline or ablation on the same faults", () => {
    for (const { setup, results, result } of rows) {
      for (const [mode, other] of Object.entries(results)) {
        expect({
          seed: setup.seed,
          mode,
          better: rank[result("backstop").outcome] >= rank[other.outcome],
        }).toEqual({ seed: setup.seed, mode, better: true });
      }
    }
  });

  it("lets the retry baseline spend the whole attempt cap when its primary dies", () => {
    const killed = rows.filter(({ setup }) => setup.fate === "dies");
    expect(killed.some(({ setup }) => setup.maxAttempts > 1)).toBe(true);
    for (const { setup, result } of killed) {
      expect({
        seed: setup.seed,
        single: result("single").attempts,
        retries: result("retries").attempts,
      }).toEqual({ seed: setup.seed, single: 1, retries: setup.maxAttempts });
    }
  });

  it("gains nothing from retries alone, because every scripted fault is bound to its agent", () => {
    for (const { setup, result } of rows) {
      expect({ seed: setup.seed, outcome: result("retries").outcome }).toEqual({
        seed: setup.seed,
        outcome: result("single").outcome,
      });
    }
  });

  it("makes a customer whole, or better, whenever the work is not delivered", () => {
    const undelivered = rows
      .map(({ result }) => result("backstop"))
      .filter(({ outcome }) => outcome === "compensated" || outcome === "refunded");
    expect(undelivered.length).toBeGreaterThan(0);
    for (const backstop of undelivered)
      expect(backstop.customerReceived >= backstop.customerPaid).toBe(true);
  });

  it("pays no compensation without the bond, and refunds exactly what was paid instead", () => {
    const unbonded = rows.map(({ setup, result }) => ({ seed: setup.seed, ...result("no-bond") }));
    const undelivered = unbonded.filter(({ outcome }) => !outcome.startsWith("delivered"));
    expect(undelivered.length).toBeGreaterThan(0);
    for (const { seed, bondConsumed } of unbonded)
      expect({ seed, bondConsumed }).toEqual({ seed, bondConsumed: 0n });
    for (const { seed, outcome, customerPaid, customerReceived } of undelivered) {
      expect({ seed, outcome, customerReceived }).toEqual({
        seed,
        outcome: "refunded",
        customerReceived: customerPaid,
      });
    }
  });
});
