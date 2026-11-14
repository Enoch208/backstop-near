import type { Episode } from "@backstop/orchestrator";
import { chainMirror, type ChainParties, type ChainStep, type Rebid } from "./mirror.js";

export type ChainRun = {
  readonly taskId: string;
  readonly steps: readonly ChainStep[];
  readonly rebids: readonly Rebid[];
};

export async function replayOnChain(parties: ChainParties, episode: Episode): Promise<ChainRun> {
  const { record } = episode;
  const mirror = chainMirror(parties, { fundingFromEvents: true, repeatSettlement: true });
  const steps: ChainStep[] = [];
  for (const event of episode.driver.store.streams[record.taskId] ?? []) {
    for (const done of await mirror.apply(record, event.body)) {
      steps.push(done);
      if (done.call.ok === done.refusalExpected) {
        throw new Error(
          `${done.label}: expected ${done.refusalExpected ? "a refusal" : "success"}, got ${done.call.errorCode ?? "success"} (${done.call.txHash})`,
        );
      }
    }
  }
  return { taskId: record.taskId, steps, rebids: mirror.rebids };
}
