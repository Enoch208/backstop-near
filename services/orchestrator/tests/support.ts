import { primaryBid, publicKeys, roster } from "@backstop/agents";
import type { Command, Driver } from "../src/index.js";
import { attempt, openCheckoutTask, record, run } from "../src/index.js";

export const registry = { agentKeys: publicKeys, verifierPublicKey: roster.verifier.key.publicKey };

export function assignedTask(taskId = "checkout-test", maxAttempts = 3): Driver {
  const driver = openCheckoutTask(taskId, maxAttempts);
  run(
    driver,
    "coordinator",
    { kind: "assignPrimary", bid: primaryBid(roster.alpha, taskId, "0.30", driver.nowMs) },
    "assign",
  );
  return driver;
}

export function refusal(driver: Driver, actor: string, command: Command): string | null {
  return attempt(driver, actor, command, "probe").refused?.code ?? null;
}

export { record };
