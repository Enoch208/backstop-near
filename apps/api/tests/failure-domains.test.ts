import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { primaryBid, roster, workFor } from "@backstop/agents";
import { checkoutSuite, fixtureAccounts } from "@backstop/fixture-checkout";
import { openCheckoutTask, record, run } from "@backstop/orchestrator";
import { verifyArtifact } from "@backstop/verifier";
import { expect, it } from "vitest";
import { createRuntime } from "../src/index.js";

it("restores verified failure ownership and retains coordinator-configured provider domains", () => {
  const directory = mkdtempSync(join(tmpdir(), "backstop-domains-"));
  const statePath = join(directory, "state.sqlite");
  const driver = openCheckoutTask("domain-replay", 3);
  run(
    driver,
    "coordinator",
    {
      kind: "assignPrimary",
      bid: primaryBid(roster.alpha, driver.taskId, "0.40", driver.nowMs),
    },
    "primary",
  );
  run(driver, "alpha", { kind: "claim", agentId: "alpha" }, "claim");
  const artifact = workFor("alpha").artifact;
  run(
    driver,
    "alpha",
    {
      kind: "submit",
      agentId: "alpha",
      fencingToken: 1,
      artifactHash: artifact.artifactHash,
      checkpointHash: null,
    },
    "submit",
  );
  const before = record(driver);
  const evidence = verifyArtifact({
    taskId: driver.taskId,
    attempt: 1,
    fencingToken: 1,
    policyHash: before.manifestHash,
    artifactHash: artifact.artifactHash,
    artifactSource: artifact.source,
    suite: checkoutSuite,
    suiteHash: before.manifest.suite.suiteHash,
    runnerId: before.manifest.suite.runnerId,
    verifierAccount: fixtureAccounts.verifier,
    signer: roster.verifier.key,
  });
  expect(evidence.body.verdict).toBe("REJECT");
  run(driver, "verifier", { kind: "recordVerification", evidence }, "reject");
  const domains = { alpha: "provider-a", beta: "provider-a", epsilon: "provider-b" };
  let runtime = createRuntime(() => driver.nowMs, false, statePath, domains);
  try {
    domains.alpha = "changed-after-construction";
    expect(runtime.registry.agentFailureDomains?.alpha).toBe("provider-a");
    runtime.store = driver.store;
    runtime.persistence?.flush(runtime, driver.store.streams[driver.taskId] ?? []);
    runtime.persistence?.close();
    runtime = createRuntime(() => driver.nowMs, false, statePath, {
      alpha: "provider-a",
      beta: "provider-a",
      epsilon: "provider-b",
    });
    expect(runtime.registry.agentFailureDomains).toEqual({
      alpha: "provider-a",
      beta: "provider-a",
      epsilon: "provider-b",
    });
    const restored = runtime.store.records[driver.taskId];
    expect(restored?.failures).toEqual([
      { attempt: 1, reason: "VERDICT_REJECTED", agents: ["alpha"] },
    ]);
    expect(restored?.recoveryFeedback).toEqual(record(driver).recoveryFeedback);
    expect(restored?.state).toBe("RECOVERY_OPEN");
    runtime.persistence?.close();
    runtime = createRuntime(() => driver.nowMs, false, statePath);
    expect(runtime.registry.agentFailureDomains).toBeUndefined();
    expect(runtime.store.records[driver.taskId]?.failures).toEqual(restored?.failures);
  } finally {
    runtime.persistence?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
