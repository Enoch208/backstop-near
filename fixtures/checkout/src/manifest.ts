import {
  manifestVersion,
  near,
  taskManifestSchema,
  toYocto,
  type TaskManifest,
  type TaskPolicy,
} from "@backstop/shared";
import { checkoutRunnerId, checkoutSuite, checkoutSuiteHash } from "./suite.js";

export const fixtureAccounts = {
  customer: "customer.fixture.testnet",
  guarantor: "guarantor.fixture.testnet",
  verifier: "verifier.fixture.testnet",
} as const;

export type CheckoutTaskOptions = {
  readonly taskId: string;
  readonly createdAtMs: number;
  readonly maxAttempts: number;
  readonly timing?: Omit<TaskPolicy, "maxAttempts">;
};

const episodeTiming: Omit<TaskPolicy, "maxAttempts"> = {
  leaseMs: 30_000,
  heartbeatGraceMs: 5_000,
  bidWindowMs: 10_000,
  challengeWindowMs: 15_000,
};

export const liveTiming: Omit<TaskPolicy, "maxAttempts"> = {
  leaseMs: 4_000,
  heartbeatGraceMs: 1_000,
  bidWindowMs: 3_000,
  challengeWindowMs: 3_000,
};

export function checkoutManifest(options: CheckoutTaskOptions): TaskManifest {
  return taskManifestSchema.parse({
    version: manifestVersion,
    taskId: options.taskId,
    owner: fixtureAccounts.customer,
    objective:
      "Repair checkoutTotal so subtotal, discount, tax, shipping and total follow the published checkout rules.",
    suite: {
      suiteId: checkoutSuite.suiteId,
      suiteHash: checkoutSuiteHash,
      runnerId: checkoutRunnerId,
    },
    allowedTools: ["read_workspace", "write_patch", "run_public_tests"],
    deadlineMs: options.createdAtMs + 30 * 60_000,
    budget: { escrowYocto: toYocto(near("0.40")), premiumYocto: toYocto(near("0.04")) },
    guarantee: {
      maxLiabilityYocto: toYocto(near("0.25")),
      compensationCapYocto: toYocto(near("0.10")),
    },
    policy: { maxAttempts: options.maxAttempts, ...(options.timing ?? episodeTiming) },
  });
}
