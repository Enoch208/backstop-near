import { payoutPreferences, roster } from "@backstop/agents";
import type { IntentQuote, IntentQuoter } from "@backstop/near";
import type { TaskRecord } from "@backstop/orchestrator";
import type { Runtime } from "./runtime.js";

export type IntentsConfig = { readonly quote: IntentQuoter; readonly refundTo: string };

export type PayoutQuote = {
  readonly transferId: string;
  readonly agentId: string;
  readonly payoutYocto: string;
  readonly wants: string;
  readonly recipient: string;
  readonly quote: IntentQuote | null;
  readonly error: string | null;
  readonly quotedAtMs: number;
};

const agentByAccount = (account: string) =>
  Object.values(roster).find((agent) => agent.account === account)?.agentId ?? null;

export function quotePayouts(runtime: Runtime, record: TaskRecord): Promise<void> {
  const intents = runtime.intents;
  if (intents === null) return Promise.resolve();
  const legs = record.ledger.transfers.flatMap((transfer) => {
    const agentId = transfer.purpose === "payout" ? agentByAccount(transfer.recipient) : null;
    const preference = agentId === null ? undefined : payoutPreferences[agentId];
    return agentId === null || preference === undefined ? [] : [{ transfer, agentId, preference }];
  });
  return Promise.all(
    legs.map(async ({ transfer, agentId, preference }) => {
      const base = {
        transferId: transfer.id,
        agentId,
        payoutYocto: transfer.amount.toString(),
        wants: preference.label,
        recipient: preference.recipient,
      };
      try {
        const quote = await intents.quote({
          amountYocto: transfer.amount,
          preference,
          refundTo: intents.refundTo,
          deadline: new Date(runtime.now() + 3_600_000),
        });
        return { ...base, quote, error: null, quotedAtMs: runtime.now() };
      } catch (error) {
        return {
          ...base,
          quote: null,
          error: error instanceof Error ? error.message : String(error),
          quotedAtMs: runtime.now(),
        };
      }
    }),
  ).then((quotes) => {
    runtime.payouts.set(record.taskId, quotes);
  });
}
