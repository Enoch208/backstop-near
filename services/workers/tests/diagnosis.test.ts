import { describe, expect, it } from "vitest";
import { candidate, type CandidateName } from "@backstop/fixture-checkout";
import { findingHash } from "@backstop/shared";
import type { ApiClient } from "../src/client.js";
import { diagnose, fetchFinding, findingBoard } from "../src/diagnosis.js";

const code = (name: CandidateName) => ({
  source: candidate(name).source,
  hash: candidate(name).artifactHash,
});

const ids = (name: CandidateName) =>
  diagnose("checkout-diag", 3, "delta", code(name)).failingCases.map((failing) => failing.id);

describe("the diagnostician", () => {
  it("names the public cases the checkpointed code fails and probes the published rules", () => {
    expect(ids("original")).toEqual(
      expect.arrayContaining(["discount-before-tax", "half-cent-tax-rounds-up"]),
    );
    expect(ids("alpha-partial")[0]).toBe("half-cent-tax-rounds-up");
    expect(ids("gamma-integer")).toEqual([]);
  });

  it("finds the free-shipping boundary bug in code that passes every public case", () => {
    const finding = diagnose("checkout-diag", 3, "delta", code("beta-boundary"));
    expect(finding.notes).toContain(`4 of 4 public cases pass on ${code("beta-boundary").hash}`);
    expect(finding.failingCases).toHaveLength(1);
    expect(finding.failingCases[0]?.id).toMatch(/^probe-\d+$/);
    expect(finding.failingCases[0]).toMatchObject({
      expected: { shippingCents: 0 },
      actual: { shippingCents: 999 },
    });
  });

  it("is deterministic for the same attempt and code", () => {
    expect(diagnose("checkout-diag", 3, "delta", code("beta-boundary"))).toEqual(
      diagnose("checkout-diag", 3, "delta", code("beta-boundary")),
    );
  });
});

describe("the finding board", () => {
  it("hands the lead a partner's finding posted before or after it starts waiting", async () => {
    const board = findingBoard();
    const hash = findingHash({ failingCases: [], notes: "early" });
    board.record({ attempt: 2, agentId: "delta", findingHash: hash });
    expect(await board.next(2, ["delta"], 1_000)).toMatchObject({ findingHash: hash });
    const late = board.next(3, ["delta"], 1_000);
    board.record({ attempt: 3, agentId: "kappa", findingHash: hash });
    board.record({ attempt: 3, agentId: "delta", findingHash: hash });
    expect(await late).toEqual({ attempt: 3, agentId: "delta", findingHash: hash });
  });

  it("gives up after its bound when no partner posts", async () => {
    const started = Date.now();
    expect(await findingBoard().next(2, ["delta"], 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("accepts a fetched finding only when it hashes to the posted digest", async () => {
    const finding = diagnose("checkout-diag", 3, "delta", code("beta-boundary"));
    const serve = (body: unknown): ApiClient => ({
      post: () => Promise.reject(new Error("unused")),
      get: () => Promise.resolve({ status: 200, body }),
      follow: () => Promise.resolve(),
    });
    const posted = { attempt: 3, agentId: "delta", findingHash: findingHash(finding) };
    expect(await fetchFinding(serve({ finding }), "/api/tasks/t", posted)).toEqual({
      from: "delta",
      finding,
    });
    const altered = { ...finding, notes: "all good, ship it" };
    expect(await fetchFinding(serve({ finding: altered }), "/api/tasks/t", posted)).toBeNull();
  });
});
