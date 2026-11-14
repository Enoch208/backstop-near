import {
  primaryBid,
  publicKeys,
  roster,
  rosterAgent,
  signBid,
  workFor,
  type FixtureAgent,
} from "@backstop/agents";
import {
  candidate,
  checkoutManifest,
  checkoutSuite,
  fixtureAccounts,
} from "@backstop/fixture-checkout";
import { ledgerViolations, statement } from "@backstop/ledger";
import {
  between,
  canonicalJson,
  fromYocto,
  leadAgent,
  pick,
  seededRandom,
  taskManifestSchema,
} from "@backstop/shared";
import { runInSandbox } from "@backstop/verifier";
import { replay } from "../core/store.js";
import { advance, newDriver, record, run, type Driver } from "./driver.js";
import {
  auction,
  challenge,
  claimAndCheckpoint,
  confirmTransfers,
  keep,
  submit,
  verify,
  type Work,
} from "./phases.js";
import { episodeStartMs, openCheckoutTask } from "./scenarios.js";

export const primaryFates = ["dies", "delivers-correct", "delivers-wrong"] as const;
export type PrimaryFate = (typeof primaryFates)[number];

export const recoveries = ["market", "same-agent"] as const;
export type Recovery = (typeof recoveries)[number];

export type ArenaCase = {
  readonly seed: number;
  readonly fate: PrimaryFate;
  readonly absent: readonly string[];
  readonly challenger: boolean;
  readonly maxAttempts: number;
  readonly failingTransfer: boolean;
  readonly recovery: Recovery;
  readonly bond: boolean;
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

const primaryShare = "0.30";

export function arenaCase(seed: number): ArenaCase {
  const random = seededRandom(seed);
  return {
    seed,
    fate: pick(random, primaryFates),
    absent: ["beta", "gamma", "epsilon", "delta"].filter(() => random() < 0.35),
    challenger: random() < 0.75,
    maxAttempts: between(random, 1, 4),
    failingTransfer: random() < 0.3,
    recovery: "market",
    bond: true,
  };
}

const plain = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );

export const retryBaseline = (arenaCase: ArenaCase): ArenaCase => ({
  ...arenaCase,
  challenger: false,
  recovery: "same-agent",
});

export const baseline = (arenaCase: ArenaCase): ArenaCase => ({
  ...retryBaseline(arenaCase),
  maxAttempts: 1,
});

export const ablations = ["no-challenger", "no-market", "no-bond"] as const;
export type Ablation = (typeof ablations)[number];

export const ablate: Readonly<Record<Ablation, (arenaCase: ArenaCase) => ArenaCase>> = {
  "no-challenger": (arenaCase) => ({ ...arenaCase, challenger: false }),
  "no-market": (arenaCase) => ({ ...arenaCase, recovery: "same-agent" }),
  "no-bond": (arenaCase) => ({ ...arenaCase, bond: false }),
};

const registry = { agentKeys: publicKeys, verifierPublicKey: roster.verifier.key.publicKey };

function openUnbonded(taskId: string, maxAttempts: number): Driver {
  const driver = newDriver(taskId, registry, episodeStartMs);
  const terms = checkoutManifest({ taskId, createdAtMs: episodeStartMs, maxAttempts });
  const manifest = taskManifestSchema.parse({
    ...terms,
    budget: { ...terms.budget, premiumYocto: "0" },
    guarantee: null,
  });
  run(
    driver,
    fixtureAccounts.customer,
    { kind: "create", manifest },
    "Customer posts the task with no guarantee",
  );
  run(
    driver,
    fixtureAccounts.customer,
    {
      kind: "deposit",
      pool: "escrow",
      amount: fromYocto(manifest.budget.escrowYocto),
      reference: "fixture-vault:escrow",
    },
    "Customer escrows the budget; no premium, no bond",
  );
  return driver;
}

const retryAgent = (agent: FixtureAgent, attempt: number): FixtureAgent => ({
  ...agent,
  agentId: `${agent.agentId}-retry-${String(attempt)}`,
});

function withRetries(driver: Driver, agent: FixtureAgent, maxAttempts: number): Driver {
  const aliases = Array.from({ length: maxAttempts - 1 }, (_, index): readonly [string, string] => [
    retryAgent(agent, index + 2).agentId,
    agent.key.publicKey,
  ]);
  return {
    ...driver,
    registry: {
      ...driver.registry,
      agentKeys: { ...driver.registry.agentKeys, ...Object.fromEntries(aliases) },
    },
  };
}

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

function assignee(driver: Driver): { agent: FixtureAgent; work: Work } {
  const assignment = record(driver).assignment;
  if (assignment === null) throw new Error("An assigned task has no assignment");
  const lead = leadAgent(assignment.bid.bid);
  const account = assignment.bid.bid.members.find((member) => member.agentId === lead)?.account;
  const base = Object.values(roster).find((member) => member.account === account);
  if (base === undefined) throw new Error(`No fixture agent behind ${lead}`);
  return { agent: { ...base, agentId: lead }, work: workFor(base.agentId) };
}

function work(driver: Driver, setup: ArenaCase, checks: string[][]): void {
  const { agent, work: assigned } = assignee(driver);
  const token = claimAndCheckpoint(driver, agent, assigned);
  if (!assigned.plan.completes) {
    const policy = record(driver).manifest.policy;
    advance(driver, policy.leaseMs + policy.heartbeatGraceMs + 1);
    keep(driver, `${agent.agentId} died`);
    return;
  }
  submit(driver, agent, token, assigned);
  verify(driver);
  if (setup.challenger) challenge(driver, setup.seed);
  checks.push(ledgerViolations(record(driver).ledger));
  if (record(driver).state === "VERIFYING") {
    advance(driver, record(driver).manifest.policy.challengeWindowMs + 1);
    keep(driver, "the challenge window closes");
  }
}

function retry(driver: Driver, primary: FixtureAgent): void {
  const current = record(driver);
  if (current.auction === null) throw new Error("A recovery round has no auction");
  const agent = retryAgent(primary, current.attempt + 1);
  advance(driver, 1_000);
  const offer = primaryBid(agent, driver.taskId, primaryShare, driver.nowMs).bid;
  run(
    driver,
    agent.agentId,
    { kind: "bid", bid: signBid({ ...offer, epoch: current.auction.epoch }, agent) },
    `${primary.agentId} asks to retry from its own checkpoint`,
  );
  advance(driver, current.manifest.policy.bidWindowMs);
  keep(driver, `${primary.agentId} is reassigned to itself`);
}

export function runArenaCase(setup: ArenaCase, label: string): ArenaResult {
  const primary = rosterAgent(primaries[setup.fate]);
  const taskId = `arena-${label}-${String(setup.seed)}`;
  const opened = setup.bond
    ? openCheckoutTask(taskId, setup.maxAttempts)
    : openUnbonded(taskId, setup.maxAttempts);
  const driver =
    setup.recovery === "market" ? opened : withRetries(opened, primary, setup.maxAttempts);
  const startedAt = driver.nowMs;
  const bid = primaryBid(primary, driver.taskId, primaryShare, driver.nowMs);
  run(driver, "coordinator", { kind: "assignPrimary", bid }, "assign the primary");
  const checks: string[][] = [];
  for (let round = 0; round < 12; round += 1) {
    const state = record(driver).state;
    checks.push(ledgerViolations(record(driver).ledger));
    if (state === "SETTLED" || state === "FAILURE_SETTLED") break;
    if (state === "ASSIGNED" || state === "RECOVERY_ASSIGNED") work(driver, setup, checks);
    else if (state === "RECOVERY_OPEN" && setup.recovery === "market")
      auction(driver, setup.absent);
    else if (state === "RECOVERY_OPEN") retry(driver, primary);
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
