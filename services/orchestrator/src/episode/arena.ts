import { primaryBid, roster, rosterAgent } from "@backstop/agents";
import { candidate, checkoutSuite } from "@backstop/fixture-checkout";
import { ledgerViolations, statement } from "@backstop/ledger";
import { between, canonicalJson, leadAgent, pick, seededRandom } from "@backstop/shared";
import { runInSandbox } from "@backstop/verifier";
import { replay } from "../core/store.js";
import { advance, record, run, type Driver } from "./driver.js";
import {
  auction,
  challenge,
  claimAndCheckpoint,
  confirmTransfers,
  keep,
  submit,
  verify,
} from "./phases.js";
import { openCheckoutTask } from "./scenarios.js";

export const primaryFates = ["dies", "delivers-correct", "delivers-wrong"] as const;
export type PrimaryFate = (typeof primaryFates)[number];

export type ArenaCase = {
  readonly seed: number;
  readonly fate: PrimaryFate;
  readonly absent: readonly string[];
  readonly challenger: boolean;
  readonly maxAttempts: number;
  readonly failingTransfer: boolean;
};

export type ArenaOutcome = "delivered-correct" | "delivered-wrong" | "compensated" | "refunded";

export type ArenaResult = {
  readonly outcome: ArenaOutcome;
  readonly state: string;
  readonly attempts: number;
  readonly settledAfterMs: number;
  readonly customerPaid: bigint;
  readonly customerReceived: bigint;
  readonly bondConsumed: bigint;
  readonly ledgerChecks: number;
  readonly violations: readonly string[];
  readonly replayMatches: boolean;
};

const primaries: Readonly<Record<PrimaryFate, string>> = {
  dies: "alpha",
  "delivers-correct": "gamma",
  "delivers-wrong": "beta",
};

export function arenaCase(seed: number): ArenaCase {
  const random = seededRandom(seed);
  return {
    seed,
    fate: pick(random, primaryFates),
    absent: ["beta", "gamma", "epsilon", "delta"].filter(() => random() < 0.35),
    challenger: random() < 0.75,
    maxAttempts: between(random, 1, 4),
    failingTransfer: random() < 0.3,
  };
}

const plain = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );

export const baseline = (arenaCase: ArenaCase): ArenaCase => ({
  ...arenaCase,
  challenger: false,
  maxAttempts: 1,
});

function truthOf(driver: Driver): boolean {
  const accepted = record(driver).candidate;
  const artifact = ["beta-boundary", "gamma-integer", "alpha-partial"] as const;
  const source = artifact
    .map(candidate)
    .find((item) => item.artifactHash === accepted?.artifactHash)?.source;
  if (source === undefined) return false;
  const probes = [10_000, 5_000, 9_999, 10_001].map((threshold) => ({
    lines: [{ sku: "edge", unitPriceCents: threshold, quantity: 1 }],
    discountPercent: 0,
    taxRateBps: 725,
    shippingCents: 999,
    freeShippingThresholdCents: 10_000,
  }));
  const inputs = [...checkoutSuite.cases.map((testCase) => testCase.input), ...probes];
  const expected = runInSandbox(checkoutSuite.oracleSource, checkoutSuite.entry, inputs);
  const actual = runInSandbox(source, checkoutSuite.entry, inputs);
  return canonicalJson(expected) === canonicalJson(actual);
}

function work(driver: Driver, setup: ArenaCase, checks: string[][]): void {
  const assignment = record(driver).assignment;
  if (assignment === null) throw new Error("An assigned task has no assignment");
  const lead = leadAgent(assignment.bid.bid);
  if (lead === "alpha") {
    claimAndCheckpoint(driver, roster.alpha);
    const policy = record(driver).manifest.policy;
    advance(driver, policy.leaseMs + policy.heartbeatGraceMs + 1);
    keep(driver, "the primary died");
    return;
  }
  const agent = rosterAgent(lead);
  submit(driver, agent, claimAndCheckpoint(driver, agent));
  verify(driver);
  if (setup.challenger) challenge(driver, setup.seed);
  checks.push(ledgerViolations(record(driver).ledger));
  if (record(driver).state === "VERIFYING") {
    advance(driver, record(driver).manifest.policy.challengeWindowMs + 1);
    keep(driver, "the challenge window closes");
  }
}

export function runArenaCase(setup: ArenaCase, label: string): ArenaResult {
  const driver = openCheckoutTask(`arena-${label}-${String(setup.seed)}`, setup.maxAttempts);
  const startedAt = driver.nowMs;
  const bid = primaryBid(rosterAgent(primaries[setup.fate]), driver.taskId, "0.30", driver.nowMs);
  run(driver, "coordinator", { kind: "assignPrimary", bid }, "assign the primary");
  const checks: string[][] = [];
  for (let round = 0; round < 12; round += 1) {
    const state = record(driver).state;
    checks.push(ledgerViolations(record(driver).ledger));
    if (state === "SETTLED" || state === "FAILURE_SETTLED") break;
    if (state === "ASSIGNED" || state === "RECOVERY_ASSIGNED") work(driver, setup, checks);
    else if (state === "RECOVERY_OPEN") auction(driver, setup.absent);
    else if (state === "ACCEPTED" || state === "TERMINAL_FAILURE") {
      keep(driver, "settle");
      confirmTransfers(driver, setup.failingTransfer);
    } else keep(driver, "advance");
  }
  const final = record(driver);
  const view = statement(final.ledger);
  const customer = final.manifest.owner;
  const received = view.confirmedByRecipient[customer] ?? 0n;
  const paid = final.ledger.inflow.escrow + final.ledger.inflow.premium;
  const delivered = final.state === "SETTLED";
  const outcome: ArenaOutcome = delivered
    ? truthOf(driver)
      ? "delivered-correct"
      : "delivered-wrong"
    : final.ledger.bondConsumed > 0n
      ? "compensated"
      : "refunded";
  const stream = driver.store.streams[driver.taskId] ?? [];
  return {
    outcome,
    state: final.state,
    attempts: final.attempt,
    settledAfterMs: (stream.at(-1)?.atMs ?? startedAt) - startedAt,
    customerPaid: paid,
    customerReceived: received,
    bondConsumed: final.ledger.bondConsumed,
    ledgerChecks: checks.length,
    violations: [...new Set(checks.flat())],
    replayMatches: plain(replay(stream)) === plain(final),
  };
}
