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
