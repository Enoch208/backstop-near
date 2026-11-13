import {
  between,
  pick,
  seededRandom,
  type ChallengeRuling,
  type Digest,
  type Random,
  type TestSuite,
} from "@backstop/shared";
import { judgeChallenge } from "@backstop/verifier";

export type Order = {
  readonly lines: readonly { sku: string; unitPriceCents: number; quantity: number }[];
  readonly discountPercent: number;
  readonly taxRateBps: number;
  readonly shippingCents: number;
  readonly freeShippingThresholdCents: number;
};

export type ChallengeTarget = {
  readonly taskId: string;
  readonly attempt: number;
  readonly artifactHash: Digest;
  readonly artifactSource: string;
  readonly suite: TestSuite;
};

export type ChallengeSearch = {
  readonly probes: number;
  readonly ruling: ChallengeRuling | null;
  readonly input: Order | null;
};

const thresholds = [5_000, 10_000] as const;
const taxRates = [0, 500, 725, 825, 1_000, 1_350] as const;
const discounts = [0, 5, 10, 15, 20, 25, 50] as const;

function randomOrder(random: Random): Order {
  return {
    lines: Array.from({ length: between(random, 1, 3) }, (_, index) => ({
      sku: `sku-${String(index)}`,
      unitPriceCents: between(random, 1, 20_000),
      quantity: between(random, 1, 4),
    })),
    discountPercent: pick(random, discounts),
    taxRateBps: pick(random, taxRates),
    shippingCents: pick(random, [0, 499, 999]),
    freeShippingThresholdCents: pick(random, thresholds),
  };
}

function boundaryOrder(random: Random): Order {
  const threshold = pick(random, thresholds);
  const offset = pick(random, [-1, 0, 1]);
  return {
    lines: [{ sku: "edge", unitPriceCents: threshold + offset, quantity: 1 }],
    discountPercent: 0,
    taxRateBps: pick(random, taxRates),
    shippingCents: 999,
    freeShippingThresholdCents: threshold,
  };
}

export function searchCounterexample(
  target: ChallengeTarget,
  challenger: string,
  seed: number,
  budget = 200,
): ChallengeSearch {
  const random = seededRandom(seed);
  for (let probe = 1; probe <= budget; probe += 1) {
    const input = probe % 4 === 0 ? boundaryOrder(random) : randomOrder(random);
    const ruling = judgeChallenge({ ...target, input, challenger });
    if (ruling.upheld) return { probes: probe, ruling, input };
  }
  return { probes: budget, ruling: null, input: null };
}
