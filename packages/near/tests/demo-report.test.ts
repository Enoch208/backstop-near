import { roster } from "@backstop/agents";
import { candidate, checkoutManifest, checkoutSuite } from "@backstop/fixture-checkout";
import { digestOf, evidenceHash, signValue, type EvidenceBody } from "@backstop/shared";
import { verifyArtifact } from "@backstop/verifier";
import { describe, expect, it } from "vitest";
import { checkAcceptedReport } from "../../../scripts/demo-report.js";

function verifiedFixture() {
  const manifest = checkoutManifest({ taskId: "report-check", createdAtMs: 0, maxAttempts: 3 });
  const artifact = candidate("gamma-integer");
  const policyHash = digestOf(manifest);
  const verified = verifyArtifact({
    taskId: manifest.taskId,
    attempt: 2,
    fencingToken: 2,
    policyHash,
    artifactHash: artifact.artifactHash,
    artifactSource: artifact.source,
    suite: checkoutSuite,
    suiteHash: manifest.suite.suiteHash,
    runnerId: manifest.suite.runnerId,
    verifierAccount: roster.verifier.account,
    signer: roster.verifier.key,
  });
  const body: EvidenceBody = {
    ...verified.body,
    inference: {
      provider: "near-ai-cloud",
      model: "unit-test-model",
      chatId: "unit-test-chat",
      signingAddress: `0x${"0".repeat(40)}`,
      requestHash: digestOf("unit-test-request"),
      responseHash: digestOf("unit-test-response"),
      signedText: "unit-test-receipt",
      signature: `0x${"0".repeat(130)}`,
    },
  };
  const hash = evidenceHash(body);
  const evidence = {
    body,
    evidenceHash: hash,
    signature: signValue({ evidenceHash: hash }, roster.verifier.key),
  };
  return {
    artifactHash: artifact.artifactHash,
    raw: {
      task: {
        taskId: manifest.taskId,
        state: "SETTLED",
        manifest,
        manifestHash: policyHash,
        attempt: 2,
        fencingToken: 2,
        candidate: { artifactHash: artifact.artifactHash, evidence },
      },
    },
    chain: {
      task_id: manifest.taskId,
      state: "SETTLED",
      manifest_hash: policyHash.slice(7),
      owner: manifest.owner,
      transfer_ids: [],
      verdict: {
        attempt: 2,
        outcome: "ACCEPT",
        artifact_hash: artifact.artifactHash.slice(7),
        suite_hash: manifest.suite.suiteHash.slice(7),
        evidence_hash: hash.slice(7),
      },
    },
  };
}

describe("demo acceptance report", () => {
  it("reports actual verifier checks when the committed evidence matches", () => {
    const { raw, chain, artifactHash } = verifiedFixture();
    const report = checkAcceptedReport(raw, chain, artifactHash, "unit-test-model");
    expect(report.checks).toEqual({
      passed: checkoutSuite.cases.length,
      total: checkoutSuite.cases.length,
    });
  });
  it("refuses a different artifact even with a settled ledger", () => {
    const { raw, chain } = verifiedFixture();
    expect(() =>
      checkAcceptedReport(raw, chain, digestOf("wrong-artifact"), "unit-test-model"),
    ).toThrow();
  });
  it("refuses uncommitted evidence and forged check totals", () => {
    const { raw, chain, artifactHash } = verifiedFixture();
    expect(() =>
      checkAcceptedReport(
        raw,
        { ...chain, verdict: { ...chain.verdict, evidence_hash: "0".repeat(64) } },
        artifactHash,
        "unit-test-model",
      ),
    ).toThrow();
    const evidence = raw.task.candidate.evidence;
    const tampered = {
      task: {
        ...raw.task,
        candidate: {
          ...raw.task.candidate,
          evidence: { ...evidence, body: { ...evidence.body, totals: { passed: 999, failed: 0 } } },
        },
      },
    };
    expect(() => checkAcceptedReport(tampered, chain, artifactHash, "unit-test-model")).toThrow();
  });
});
