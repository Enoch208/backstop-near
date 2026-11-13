import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEpisode } from "@backstop/orchestrator";
import { near, toYocto } from "@backstop/shared";
import type { Account } from "near-api-js";
import {
  callVault,
  deployVault,
  ensureSubAccounts,
  getLedger,
  getTransfer,
  recordVerdict,
  replayOnChain,
  startLocalChain,
  type LocalChain,
  type Vault,
} from "../src/index.js";

const parties = [
  "vault",
  "customer",
  "guarantor",
  "coordinator",
  "verifier",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
] as const;

let chain: LocalChain;
let accounts: Record<string, Account>;
let vault: Vault;

const party = (name: string): Account => {
  const account = accounts[name];
  if (account === undefined) throw new Error(`No account ${name}`);
  return account;
};

beforeAll(async () => {
  chain = await startLocalChain();
  accounts = await ensureSubAccounts(chain.root, parties, (name) =>
    name === "vault" ? near("10") : near("5"),
  );
  const deployed = await deployVault(party("vault"), {
    owner: party("vault").accountId,
    coordinator: party("coordinator").accountId,
    verifier: party("verifier").accountId,
  });
  expect(deployed.init.ok).toBe(true);
  vault = deployed.vault;
});

afterAll(async () => {
  await chain.stop();
});

describe("OutcomeVault on a local NEAR node", () => {
  it("settles the recovery episode with real promises and callbacks, exactly once", async () => {
    const episode = runEpisode("recovery", {
      failFirstTransfer: false,
      challengeSeed: 7,
      startMs: Date.now(),
      taskId: "checkout-chain",
    });
    const gammaBefore = (await party("gamma").getState()).balance.total;
    const run = await replayOnChain(
      {
        vault,
        customer: party("customer"),
        guarantor: party("guarantor"),
        coordinator: party("coordinator"),
        verifier: party("verifier"),
        payoutAccount: (agentId) => party(agentId).accountId,
      },
      episode,
    );
    expect(run.steps.map((step) => step.call.errorCode)).toEqual([
      ...Array<null>(run.steps.length - 1).fill(null),
      "ERR_ALREADY_SETTLED",
    ]);
    const ledger = await getLedger(vault, party("customer"), "checkout-chain");
    expect(ledger?.state).toBe("SETTLED");
    expect(ledger?.total_inflow).toBe(toYocto(near("0.69")));
    expect(ledger?.confirmed_outflow).toBe(toYocto(near("0.69")));
    expect(
      Object.fromEntries(
        (ledger?.confirmed_by_recipient ?? []).map((row) => [row.recipient, row.amount]),
      ),
    ).toEqual({
      [party("gamma").accountId]: toYocto(near("0.40")),
      [party("delta").accountId]: toYocto(near("0.12")),
      [party("customer").accountId]: toYocto(near("0.04")),
      [party("guarantor").accountId]: toYocto(near("0.13")),
    });
    expect((await party("gamma").getState()).balance.total - gammaBefore).toBe(near("0.40"));
    expect((await getTransfer(vault, party("customer"), "checkout-chain:3:0"))?.status).toBe(
      "CONFIRMED",
    );
    const settledEvents = run.steps.flatMap((step) => step.call.events.map((event) => event.event));
    expect(settledEvents).toEqual(
      expect.arrayContaining([
        "recovery_opened",
        "verdict_recorded",
        "transfer_confirmed",
        "task_settled",
      ]),
    );
  });

  it("refuses an outside call to the private transfer callback", async () => {
    const forged = await callVault(vault, party("customer"), "on_transfer_complete", {
      transfer_id: "checkout-chain:3:0",
      retry: 0,
    });
    expect(forged.ok).toBe(false);
  });

  it("refuses a verdict from anyone but the verifier", async () => {
    const zero = "0".repeat(64);
    const verdict = await recordVerdict(vault, party("coordinator"), "checkout-chain", {
      attempt: 3,
      artifactHash: zero,
      suiteHash: zero,
      evidenceHash: zero,
      outcome: "ACCEPT",
    });
    expect(verdict).toMatchObject({ ok: false, errorCode: "ERR_NOT_VERIFIER" });
  });
});
