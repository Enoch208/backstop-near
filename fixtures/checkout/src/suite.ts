import { readFileSync } from "node:fs";
import { z } from "zod";
import { suiteCaseSchema, suiteHash, type Digest, type TestSuite } from "@backstop/shared";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

export const checkoutRunnerId = "node-vm/backstop-runner-1";

export const checkoutSuite: TestSuite = {
  suiteId: "checkout-totals-v1",
  entry: "checkoutTotal",
  oracleSource: read("../suite/oracle.js"),
  cases: z.array(suiteCaseSchema).parse(JSON.parse(read("../suite/cases.json"))),
};

export const checkoutSuiteHash: Digest = suiteHash(checkoutSuite);

export const checkoutRules = [
  "All money is integer cents; never use fractional currency.",
  "subtotalCents is the sum of unitPriceCents times quantity over every line.",
  "discountCents is subtotalCents times discountPercent / 100, rounded half up to a whole cent.",
  "Tax applies after the discount: taxCents is (subtotalCents - discountCents) times taxRateBps / 10000, rounded half up to a whole cent.",
  "Shipping is free (0) when subtotalCents - discountCents is at least freeShippingThresholdCents; otherwise it is shippingCents.",
  "totalCents is subtotalCents - discountCents + taxCents + shippingCents.",
].join("\n");
