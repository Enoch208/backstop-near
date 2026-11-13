import { describe, expect, it } from "vitest";
import { near } from "@backstop/shared";
import { ledgerViolations, statement } from "@backstop/ledger";
import { replay, runEpisode } from "../src/index.js";

const types = (episode: ReturnType<typeof runEpisode>) =>
  episode.steps.flatMap((step) => step.events.map((event) => event.body.type));

const refusals = (episode: ReturnType<typeof runEpisode>) =>
  episode.steps.flatMap((step) => (step.refused === null ? [] : [step.refused.code]));

describe("the recovery episode", () => {
  const episode = runEpisode("recovery");

  it("kills the primary, rejects a challenged repair and settles the coalition's verified repair", () => {
    expect(episode.record.state).toBe("SETTLED");
    expect(types(episode)).toEqual(
      expect.arrayContaining([
        "lease_expired",
        "attempt_failed",
        "recovery_awarded",
        "attempt_rejected",
        "task_accepted",
        "task_settled",
      ]),
    );
    expect(episode.record.failures.map((failure) => failure.reason)).toEqual([
      "LEASE_EXPIRED",
      "CHALLENGE_UPHELD",
    ]);
    expect(episode.record.attempt).toBe(3);
  });

  it("reconciles to the canonical ledger: 0.52 to the coalition, 0.13 bond back, 0.04 premium back", () => {
    const view = statement(episode.record.ledger);
    expect(view.totalIn).toBe(near("0.69"));
    expect(view.confirmedByRecipient).toEqual({
      "gamma.fixture.testnet": near("0.40"),
      "delta.fixture.testnet": near("0.12"),
      "customer.fixture.testnet": near("0.04"),
      "guarantor.fixture.testnet": near("0.13"),
    });
    expect(episode.record.ledger.bondConsumed).toBe(near("0.12"));
    expect(ledgerViolations(episode.record.ledger)).toEqual([]);
  });

  it("TC-004 and TC-008 fence the zombie primary and refuse a second settlement", () => {
    expect(refusals(episode)).toEqual(["STALE_LEASE", "STALE_LEASE", "ALREADY_SETTLED"]);
  });

  it("G5 replays identically: two runs emit the same events", () => {
    expect(runEpisode("recovery").driver.store).toEqual(episode.driver.store);
  });

  it("TC-011 and TC-014 rebuild the same task after a restart, even from duplicated deliveries", () => {
    const stream = episode.driver.store.streams[episode.record.taskId] ?? [];
    expect(replay(stream)).toEqual(episode.record);
    expect(replay([...stream, ...stream.slice(5, 20)])).toEqual(episode.record);
  });
});

describe("the exhausted episode", () => {
  it("TC-010 refunds escrow and premium and pays compensation within the liability cap", () => {
    const episode = runEpisode("exhausted", { failFirstTransfer: true, challengeSeed: 7 });
    expect(episode.record.state).toBe("FAILURE_SETTLED");
    expect(statement(episode.record.ledger).confirmedByRecipient).toEqual({
      "customer.fixture.testnet": near("0.54"),
      "guarantor.fixture.testnet": near("0.15"),
    });
    expect(episode.record.failures.at(-1)?.reason).toBe("CHALLENGE_UPHELD");
    expect(types(episode)).toEqual(
      expect.arrayContaining(["transfer_retried", "terminal_failure"]),
    );
  });
});

describe("the primary-success episode", () => {
  it("TC-002 pays the primary, earns the guarantor the premium and releases the whole bond", () => {
    const episode = runEpisode("primary-success");
    expect(episode.record.state).toBe("SETTLED");
    expect(statement(episode.record.ledger).confirmedByRecipient).toEqual({
      "gamma.fixture.testnet": near("0.30"),
      "guarantor.fixture.testnet": near("0.29"),
      "customer.fixture.testnet": near("0.10"),
    });
  });
});
