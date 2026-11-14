import { signBid, type FixtureAgent } from "@backstop/agents";
import { digestOf, toYocto, type RecoveryStrategy } from "@backstop/shared";
import type { ApiClient } from "./client.js";
import type { Snapshot } from "./messages.js";

export type StandbyTerms = {
  readonly amount: bigint;
  readonly durationMs: number;
  readonly strategy?: RecoveryStrategy;
};

export async function reserveStandby(
  client: ApiClient,
  agent: FixtureAgent,
  task: Pick<Snapshot, "manifest" | "attempt" | "standby">,
  terms: StandbyTerms,
): Promise<void> {
  const { manifest } = task;
  const now = Date.now();
  const amount = toYocto(terms.amount);
  const firstEpoch = Math.max(1, task.attempt);
  for (let epoch = firstEpoch; epoch < manifest.policy.maxAttempts; epoch++) {
    if (manifest.deadlineMs - now < terms.durationMs) break;
    if (
      task.standby?.some(
        ({ bid }) =>
          bid.epoch === epoch &&
          bid.expiresAtMs >= now &&
          bid.members[0]?.agentId === agent.agentId,
      )
    )
      continue;
    const bid = signBid(
      {
        taskId: manifest.taskId,
        epoch,
        members: [
          { agentId: agent.agentId, account: agent.account, role: "repairer", shareYocto: amount },
        ],
        amountYocto: amount,
        estimatedDurationMs: terms.durationMs,
        planHash: digestOf("Reserve one worker for a complete repair from the pinned checkpoint"),
        committedAtMs: now,
        expiresAtMs: manifest.deadlineMs,
        purpose: "standby",
        ...(terms.strategy === undefined ? {} : { strategy: terms.strategy }),
      },
      agent,
    );
    const reply = await client.post(`/api/tasks/${manifest.taskId}/bids`, { bid });
    if (reply.status < 200 || reply.status >= 300)
      throw new Error(
        `Standby reservation for epoch ${String(epoch)} refused (HTTP ${String(reply.status)}): ${JSON.stringify(reply.body)}`,
      );
  }
}
