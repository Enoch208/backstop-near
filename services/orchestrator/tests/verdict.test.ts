import { describe, expect, it } from "vitest";
import { roster, workFor } from "@backstop/agents";
import { checkoutSuite, fixtureAccounts } from "@backstop/fixture-checkout";
import { digestOf, signingKeyFromSeed, type EvidenceBundle } from "@backstop/shared";
import { judgeChallenge, verifyArtifact } from "@backstop/verifier";
import { advance, run, type Driver } from "../src/index.js";
import { assignedTask, record, refusal } from "./support.js";

function submitted(agent: "alpha" = "alpha"): Driver {
  const driver = assignedTask();
  run(driver, agent, { kind: "claim", agentId: agent }, "claim");
  const artifact = workFor("gamma").artifact;
  run(
    driver,
    agent,
    {
      kind: "submit",
      agentId: agent,
      fencingToken: 1,
      artifactHash: artifact.artifactHash,
      checkpointHash: null,
    },
    "submit",
  );
  return driver;
}

function evidenceFor(
  driver: Driver,
  overrides: { signerSeed?: string; fencingToken?: number; source?: string } = {},
): EvidenceBundle {
  const current = record(driver);
  const artifact = workFor("gamma").artifact;
  return verifyArtifact({
    taskId: driver.taskId,
    attempt: current.attempt,
    fencingToken: overrides.fencingToken ?? 1,
    policyHash: current.manifestHash,
    artifactHash: artifact.artifactHash,
    artifactSource: overrides.source ?? artifact.source,
    suite: checkoutSuite,
    suiteHash: current.manifest.suite.suiteHash,
    runnerId: current.manifest.suite.runnerId,
    verifierAccount: fixtureAccounts.verifier,
    signer:
      overrides.signerSeed === undefined
        ? roster.verifier.key
        : signingKeyFromSeed(overrides.signerSeed),
  });
}

describe("verdicts and challenges", () => {
  it("TC-012 refuses evidence signed by anyone but the authorized verifier", () => {
    const driver = submitted();
    expect(
      refusal(driver, "mallory", {
        kind: "recordVerification",
        evidence: evidenceFor(driver, { signerSeed: "mallory" }),
      }),
    ).toBe("BAD_SIGNATURE");
  });

  it("refuses evidence produced for a stale fencing token", () => {
    const driver = submitted();
    expect(
      refusal(driver, "verifier", {
        kind: "recordVerification",
        evidence: evidenceFor(driver, { fencingToken: 7 }),
      }),
    ).toBe("STALE_LEASE");
  });

  it("FR-025 a provisional pass is not acceptance: settlement waits for the challenge window", () => {
    const driver = submitted();
    run(
      driver,
      "verifier",
      { kind: "recordVerification", evidence: evidenceFor(driver) },
      "verify",
    );
    expect(record(driver).state).toBe("VERIFYING");
    expect(refusal(driver, "coordinator", { kind: "settle" })).toBe("INVALID_TRANSITION");
    expect(refusal(driver, "keeper", { kind: "closeChallengeWindow" })).toBe("POLICY_VIOLATION");
    advance(driver, 15_001);
    run(driver, "keeper", { kind: "closeChallengeWindow" }, "accept");
    expect(record(driver).state).toBe("ACCEPTED");
  });

  it("a rejected verdict reopens the market instead of paying", () => {
    const driver = submitted();
    const broken = workFor("alpha").artifact.source;
    const evidence = evidenceFor(driver, { source: broken });
    expect(evidence.body.verdict).toBe("REJECT");
    run(driver, "verifier", { kind: "recordVerification", evidence }, "verify");
    expect(record(driver).state).toBe("RECOVERY_OPEN");
    expect(record(driver).ledger.transfers).toEqual([]);
  });

  it("dismisses a failed challenge and refuses one after the window", () => {
    const driver = submitted();
    run(
      driver,
      "verifier",
      { kind: "recordVerification", evidence: evidenceFor(driver) },
      "verify",
    );
    const artifact = workFor("gamma").artifact;
    const ruling = judgeChallenge({
      taskId: driver.taskId,
      attempt: 1,
      artifactHash: artifact.artifactHash,
      artifactSource: artifact.source,
      suite: checkoutSuite,
      input: {
        lines: [],
        discountPercent: 0,
        taxRateBps: 0,
        shippingCents: 0,
        freeShippingThresholdCents: 1,
      },
      challenger: "kappa",
    });
    expect(ruling.upheld).toBe(false);
    run(driver, "kappa", { kind: "challenge", ruling }, "challenge");
    expect(record(driver).state).toBe("VERIFYING");
    advance(driver, 15_001);
    expect(
      refusal(driver, "kappa", {
        kind: "challenge",
        ruling: { ...ruling, upheld: true, reproducerHash: digestOf("late") },
      }),
    ).toBe("CHALLENGE_WINDOW_CLOSED");
  });
});
