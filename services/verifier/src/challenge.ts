import {
  canonicalJson,
  digestOf,
  type ChallengeRuling,
  type Digest,
  type TestSuite,
} from "@backstop/shared";
import { runInSandbox } from "./sandbox.js";

export type ChallengeRequest = {
  readonly taskId: string;
  readonly attempt: number;
  readonly artifactHash: Digest;
  readonly artifactSource: string;
  readonly suite: TestSuite;
  readonly input: unknown;
  readonly challenger: string;
};

export function judgeChallenge(request: ChallengeRequest): ChallengeRuling {
  const [oracle] = runInSandbox(request.suite.oracleSource, request.suite.entry, [request.input]);
  const [candidate] = runInSandbox(request.artifactSource, request.suite.entry, [request.input]);
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
