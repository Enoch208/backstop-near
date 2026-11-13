import {
  canonicalJson,
  evidenceHash,
  signValue,
  type CheckResult,
  type Digest,
  type EvidenceBody,
  type EvidenceBundle,
  type SigningKey,
  type TestSuite,
  type SuiteCase,
} from "@backstop/shared";
import { runInSandbox, type RunResult } from "./sandbox.js";

export type VerificationRequest = {
  readonly taskId: string;
  readonly attempt: number;
  readonly fencingToken: number;
  readonly policyHash: Digest;
  readonly artifactHash: Digest;
  readonly artifactSource: string;
  readonly suite: TestSuite;
  readonly suiteHash: Digest;
  readonly runnerId: string;
  readonly verifierAccount: string;
  readonly signer: SigningKey;
};

const clip = (text: string) => (text.length > 240 ? `${text.slice(0, 237)}...` : text);

function check(testCase: SuiteCase, result: RunResult | undefined): CheckResult {
  const base = { id: testCase.id, visibility: testCase.visibility };
  if (result === undefined || !result.ok) {
    return { ...base, status: "error", detail: clip(result?.error ?? "No result") };
  }
  if (canonicalJson(result.value) === canonicalJson(testCase.expected)) {
    return { ...base, status: "pass", detail: null };
  }
  return { ...base, status: "fail", detail: clip(`got ${canonicalJson(result.value)}`) };
}

export function verifyArtifact(request: VerificationRequest): EvidenceBundle {
  const results = runInSandbox(
    request.artifactSource,
    request.suite.entry,
    request.suite.cases.map((testCase) => testCase.input),
  );
  const checks = request.suite.cases.map((testCase, index) => check(testCase, results[index]));
  const passed = checks.filter((item) => item.status === "pass").length;
  const body: EvidenceBody = {
    version: "backstop-evidence-1",
    taskId: request.taskId,
    attempt: request.attempt,
    fencingToken: request.fencingToken,
    policyHash: request.policyHash,
    artifactHash: request.artifactHash,
    suiteHash: request.suiteHash,
    runnerId: request.runnerId,
    checks,
    totals: { passed, failed: checks.length - passed },
    verdict: passed === checks.length ? "ACCEPT" : "REJECT",
    verifierAccount: request.verifierAccount,
  };
  const hash = evidenceHash(body);
  return { body, evidenceHash: hash, signature: signValue({ evidenceHash: hash }, request.signer) };
}
