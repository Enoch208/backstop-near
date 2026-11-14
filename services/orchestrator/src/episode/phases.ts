import {
  decideToJoin,
  endorsement,
  fixtureBids,
  rosterAgent,
  roster,
  searchCounterexample,
  workFor,
  type FixtureAgent,
} from "@backstop/agents";
import {
  candidate,
  candidateNames,
  checkoutSuite,
  fixtureAccounts,
} from "@backstop/fixture-checkout";
import {
  formatNear,
  fromYocto,
  leadAgent,
  near,
  pendingEndorsers,
  type Digest,
  type SignedBid,
} from "@backstop/shared";
import { attestRuling, judgeChallenge, verifyArtifact } from "@backstop/verifier";
import { dueCommands } from "../core/keeper.js";
import { lastCheckpointHash } from "../core/record.js";
import { advance, attempt, record, run, type Driver } from "./driver.js";

function artifactByHash(hash: Digest) {
  const artifact = candidateNames.map(candidate).find((item) => item.artifactHash === hash);
  if (artifact === undefined) throw new Error(`No fixture artifact ${hash}`);
  return artifact;
}

export function fund(driver: Driver): void {
  run(
    driver,
    fixtureAccounts.customer,
    { kind: "deposit", pool: "escrow", amount: near("0.40"), reference: "fixture-vault:escrow" },
    "Customer escrows 0.40 NEAR",
  );
  run(
    driver,
    fixtureAccounts.customer,
    { kind: "deposit", pool: "premium", amount: near("0.04"), reference: "fixture-vault:premium" },
    "Customer pays a 0.04 NEAR guarantee premium",
  );
  run(
    driver,
    fixtureAccounts.guarantor,
    {
      kind: "postGuarantee",
      guarantor: fixtureAccounts.guarantor,
      bond: near("0.25"),
      liability: near("0.25"),
      reference: "fixture-vault:bond",
    },
    "Guarantor bonds 0.25 NEAR against the outcome",
  );
}

export function keep(driver: Driver, note: string): void {
  for (const command of dueCommands(record(driver), driver.nowMs)) {
    run(driver, "keeper", command, note);
  }
}

export type Work = ReturnType<typeof workFor>;

export function claimAndCheckpoint(
  driver: Driver,
  agent: FixtureAgent,
  work: Work = workFor(agent.agentId),
): number {
  run(
    driver,
    agent.agentId,
    { kind: "claim", agentId: agent.agentId },
    `${agent.agentId} claims the lease`,
  );
  const current = record(driver);
  const token = current.fencingToken;
  const { plan, artifact } = work;
  const checkpoint = {
    taskId: driver.taskId,
    attempt: current.attempt,
    stateVersion: current.version,
    contentHash: artifact.artifactHash,
    artifactUri: `fixture://checkout/candidates/${artifact.name}.js`,
    validatedSubtasks: [...plan.validatedSubtasks],
    provenanceEventIds: [`${driver.taskId}#${String(current.version)}`],
    parentCheckpointHash: lastCheckpointHash(current),
  };
  advance(driver, 5_000);
  run(
    driver,
    agent.agentId,
    { kind: "heartbeat", agentId: agent.agentId, fencingToken: token },
    `${agent.agentId} heartbeats`,
  );
  run(
    driver,
    agent.agentId,
    { kind: "checkpoint", agentId: agent.agentId, fencingToken: token, checkpoint },
    `${agent.agentId} checkpoints ${plan.validatedSubtasks.join(", ")}`,
  );
  return token;
}

export function submit(
  driver: Driver,
  agent: FixtureAgent,
  token: number,
  work: Work = workFor(agent.agentId),
): void {
  const { artifact } = work;
  advance(driver, 5_000);
  run(
    driver,
    agent.agentId,
    {
      kind: "submit",
      agentId: agent.agentId,
      fencingToken: token,
      artifactHash: artifact.artifactHash,
      checkpointHash: lastCheckpointHash(record(driver)),
    },
    `${agent.agentId} submits ${artifact.name}`,
  );
}

export function verify(driver: Driver): void {
  const current = record(driver);
  const submitted = current.candidate;
  if (submitted === null) throw new Error("Nothing was submitted");
  const artifact = artifactByHash(submitted.artifactHash);
  const evidence = verifyArtifact({
    taskId: driver.taskId,
    attempt: submitted.attempt,
    fencingToken: submitted.fencingToken,
    policyHash: current.manifestHash,
    artifactHash: artifact.artifactHash,
    artifactSource: artifact.source,
    suite: checkoutSuite,
    suiteHash: current.manifest.suite.suiteHash,
    runnerId: current.manifest.suite.runnerId,
    verifierAccount: fixtureAccounts.verifier,
    signer: roster.verifier.key,
  });
  run(
    driver,
    "verifier",
    { kind: "recordVerification", evidence },
    `Verifier: ${evidence.body.verdict} (${String(evidence.body.totals.passed)}/${String(evidence.body.checks.length)} checks)`,
  );
}

export function challenge(driver: Driver, seed: number): void {
  const current = record(driver);
  const submitted = current.candidate;
  if (submitted === null) return;
  const artifact = artifactByHash(submitted.artifactHash);
  const target = {
    taskId: driver.taskId,
    attempt: submitted.attempt,
    artifactHash: artifact.artifactHash,
    artifactSource: artifact.source,
    suite: checkoutSuite,
  };
  const search = searchCounterexample(target, roster.kappa.agentId, seed);
  if (search.input === null) {
    driver.steps.push({
      atMs: driver.nowMs,
      actor: "kappa",
      command: "challenge",
      note: `kappa probed ${String(search.probes)} inputs and found no counterexample`,
      events: [],
      refused: null,
    });
    return;
  }
  advance(driver, 3_000);
  const rerun = judgeChallenge({
    ...target,
    input: search.input,
    challenger: roster.kappa.agentId,
  });
  run(
    driver,
    "kappa",
    { kind: "challenge", signed: attestRuling(rerun, roster.verifier.key) },
    `kappa found a counterexample after ${String(search.probes)} probes; the verifier reproduced it`,
  );
}

function endorseIfWilling(driver: Driver, bid: SignedBid, agentId: string): void {
  const member = rosterAgent(agentId);
  const decision = decideToJoin(member, bid, record(driver).excludedAgents);
  if (!decision.join) {
    driver.steps.push({
      atMs: driver.nowMs,
      actor: agentId,
      command: "endorse",
      note: `${agentId} declines: ${decision.reason}`,
      events: [],
      refused: null,
    });
    return;
  }
  run(
    driver,
    agentId,
    { kind: "endorse", bidHash: bid.bidHash, endorsement: endorsement(bid, member) },
    `${agentId} co-signs its seat: ${decision.reason}`,
  );
}

export function auction(driver: Driver, absent: readonly string[]): SignedBid[] {
  const current = record(driver);
  const bids = fixtureBids({
    taskId: driver.taskId,
    epoch: current.epoch,
    nowMs: driver.nowMs,
    bidWindowMs: current.manifest.policy.bidWindowMs,
    excludedAgents: [...current.excludedAgents, ...absent],
  });
  for (const bid of bids) {
    advance(driver, 1_000);
    const members = bid.bid.members.map((member) => member.agentId).join("+");
    const offer = `${formatNear(fromYocto(bid.bid.amountYocto))} NEAR`;
    const pending = pendingEndorsers(bid);
    run(
      driver,
      leadAgent(bid.bid),
      { kind: "bid", bid },
      pending.length === 0
        ? `${offer} bid from ${members}`
        : `${leadAgent(bid.bid)} proposes a ${offer} coalition with ${pending.join(", ")}`,
    );
    for (const agentId of pending) endorseIfWilling(driver, bid, agentId);
  }
  advance(driver, current.manifest.policy.bidWindowMs);
  keep(driver, "Keeper closes the auction");
  return bids;
}

export function confirmTransfers(driver: Driver, failFirst: boolean): void {
  const transfers = record(driver).ledger.transfers;
  transfers.forEach((transfer, index) => {
    advance(driver, 1_000);
    if (failFirst && index === 0) {
      run(
        driver,
        "fixture-vault",
        { kind: "resolveTransfer", transferId: transfer.id, succeeded: false },
        `Transfer ${transfer.id} fails`,
      );
      run(
        driver,
        "keeper",
        { kind: "retryTransfer", transferId: transfer.id },
        `Keeper retries ${transfer.id}`,
      );
    }
    run(
      driver,
      "fixture-vault",
      { kind: "resolveTransfer", transferId: transfer.id, succeeded: true },
      `${formatNear(transfer.amount)} NEAR to ${transfer.recipient} confirms (${transfer.purpose})`,
    );
  });
}

export function expectRefusal(
  driver: Driver,
  actor: string,
  command: Parameters<typeof attempt>[2],
  note: string,
): void {
  const step = attempt(driver, actor, command, note);
  if (step.refused === null) throw new Error(`${command.kind} should have been refused`);
}
