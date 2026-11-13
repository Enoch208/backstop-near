import { primaryBid, publicKeys, roster } from "@backstop/agents";
import { checkoutManifest, fixtureAccounts } from "@backstop/fixture-checkout";
import type { TaskRecord } from "../core/record.js";
import { advance, newDriver, record, run, type Driver, type Step } from "./driver.js";
import {
  auction,
  challenge,
  claimAndCheckpoint,
  confirmTransfers,
  expectRefusal,
  fund,
  keep,
  submit,
  verify,
} from "./phases.js";

export const scenarios = ["recovery", "exhausted", "primary-success"] as const;
export type Scenario = (typeof scenarios)[number];

export type EpisodeOptions = {
  readonly failFirstTransfer: boolean;
  readonly challengeSeed: number;
};

export type Episode = {
  readonly scenario: Scenario;
  readonly steps: readonly Step[];
  readonly record: TaskRecord;
  readonly driver: Driver;
};

export const episodeStartMs = Date.UTC(2026, 10, 14, 12, 0, 0);

const registry = { agentKeys: publicKeys, verifierPublicKey: roster.verifier.key.publicKey };

export function openCheckoutTask(taskId: string, maxAttempts: number): Driver {
  const driver = newDriver(taskId, registry, episodeStartMs);
  const manifest = checkoutManifest({ taskId, createdAtMs: episodeStartMs, maxAttempts });
  run(
    driver,
    fixtureAccounts.customer,
    { kind: "create", manifest },
    "Customer posts the broken checkout task",
  );
  fund(driver);
  return driver;
}

function killPrimary(driver: Driver): void {
  const bid = primaryBid(roster.alpha, driver.taskId, "0.30", driver.nowMs);
  run(
    driver,
    "coordinator",
    { kind: "assignPrimary", bid },
    "Coordinator assigns alpha as the primary",
  );
  const token = claimAndCheckpoint(driver, roster.alpha);
  advance(
    driver,
    record(driver).manifest.policy.leaseMs + record(driver).manifest.policy.heartbeatGraceMs + 1,
  );
  keep(driver, "alpha was killed: its heartbeats stopped and the lease lapsed");
  expectRefusal(
    driver,
    "alpha",
    { kind: "heartbeat", agentId: "alpha", fencingToken: token },
    "alpha's zombie heartbeat is fenced off",
  );
}

function recoverWith(driver: Driver, lead: typeof roster.beta, seed: number): void {
  const token = claimAndCheckpoint(driver, lead);
  submit(driver, lead, token);
  verify(driver);
  challenge(driver, seed);
}

function settle(driver: Driver, options: EpisodeOptions): void {
  advance(driver, record(driver).manifest.policy.challengeWindowMs + 1);
  keep(driver, "Keeper closes the challenge window");
  keep(driver, "Keeper settles the task");
  confirmTransfers(driver, options.failFirstTransfer);
}

function recovery(options: EpisodeOptions): Driver {
  const driver = openCheckoutTask("checkout-recovery", 3);
  killPrimary(driver);
  auction(driver, []);
  recoverWith(driver, roster.beta, options.challengeSeed);
  expectRefusal(
    driver,
    "alpha",
    {
      kind: "submit",
      agentId: "alpha",
      fencingToken: 1,
      artifactHash:
        record(driver).checkpoints[0]?.checkpoint.contentHash ?? "sha256:" + "0".repeat(64),
      checkpointHash: null,
    },
    "alpha's late result is rejected: stale fencing token",
  );
  auction(driver, []);
  recoverWith(driver, roster.gamma, options.challengeSeed);
  settle(driver, options);
  expectRefusal(driver, "coordinator", { kind: "settle" }, "A repeated settlement is refused");
  return driver;
}

function exhausted(options: EpisodeOptions): Driver {
  const driver = openCheckoutTask("checkout-exhausted", 2);
  killPrimary(driver);
  auction(driver, ["gamma", "delta", "epsilon"]);
  recoverWith(driver, roster.beta, options.challengeSeed);
  keep(driver, "Keeper settles the failure");
  confirmTransfers(driver, options.failFirstTransfer);
  return driver;
}

function primarySuccess(options: EpisodeOptions): Driver {
  const driver = openCheckoutTask("checkout-primary", 3);
  const bid = primaryBid(roster.gamma, driver.taskId, "0.30", driver.nowMs);
  run(
    driver,
    "coordinator",
    { kind: "assignPrimary", bid },
    "Coordinator assigns gamma as the primary",
  );
  recoverWith(driver, roster.gamma, options.challengeSeed);
  settle(driver, options);
  return driver;
}

export function runEpisode(
  scenario: Scenario,
  options: EpisodeOptions = { failFirstTransfer: false, challengeSeed: 7 },
): Episode {
  const driver =
    scenario === "recovery"
      ? recovery(options)
      : scenario === "exhausted"
        ? exhausted(options)
        : primarySuccess(options);
  return { scenario, steps: driver.steps, record: record(driver), driver };
}
