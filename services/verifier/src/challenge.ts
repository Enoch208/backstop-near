import {
  canonicalJson,
  digestOf,
  signValue,
  type ChallengeRuling,
  type Digest,
  type SignedChallengeRuling,
  type SigningKey,
  type TestSuite,
} from "@backstop/shared";
import { runInSandbox, type Runner } from "./sandbox.js";

export type ChallengeRequest = {
  readonly taskId: string;
  readonly attempt: number;
  readonly artifactHash: Digest;
  readonly artifactSource: string;
  readonly suite: TestSuite;
  readonly input: unknown;
  readonly challenger: string;
};

export function judgeChallenge(
  request: ChallengeRequest,
  run: Runner = runInSandbox,
): ChallengeRuling {
  const [oracle] = run(request.suite.oracleSource, request.suite.entry, [request.input]);
  const [candidate] = run(request.artifactSource, request.suite.entry, [request.input]);
  const expected = oracle?.ok === true ? oracle.value : null;
  const actual = candidate?.ok === true ? candidate.value : null;
  const upheld =
    oracle?.ok === true &&
    (candidate?.ok !== true || canonicalJson(actual) !== canonicalJson(expected));
  return {
    taskId: request.taskId,
    attempt: request.attempt,
    artifactHash: request.artifactHash,
    reproducerHash: digestOf(request.input),
    upheld,
    expected,
    actual,
    challenger: request.challenger,
  };
}

export function attestRuling(ruling: ChallengeRuling, signer: SigningKey): SignedChallengeRuling {
  return { ruling, signature: signValue(ruling, signer) };
}
