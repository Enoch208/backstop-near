import { digestOf, signingKeyFromSeed } from "@backstop/shared";
import {
  candidate,
  checkoutRunnerId,
  checkoutSuite,
  checkoutSuiteHash,
  type CandidateName,
} from "@backstop/fixture-checkout";
import type { VerificationRequest } from "../src/index.js";

export const verifierKey = signingKeyFromSeed("backstop-fixture-key:verifier");

export function requestFor(name: CandidateName): VerificationRequest {
  const artifact = candidate(name);
  return {
    taskId: "checkout-001",
    attempt: 2,
    fencingToken: 2,
    policyHash: digestOf("policy"),
    artifactHash: artifact.artifactHash,
    artifactSource: artifact.source,
    suite: checkoutSuite,
    suiteHash: checkoutSuiteHash,
    runnerId: checkoutRunnerId,
    verifierAccount: "verifier.fixture.testnet",
    signer: verifierKey,
  };
}

export const exactThresholdOrder = {
  lines: [{ sku: "coat", unitPriceCents: 10_000, quantity: 1 }],
  discountPercent: 0,
  taxRateBps: 0,
  shippingCents: 999,
  freeShippingThresholdCents: 10_000,
};
