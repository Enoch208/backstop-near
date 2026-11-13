import { z } from "zod";
import { parseEventLog, type VaultEvent } from "./wire.js";

const receiptSchema = z.object({
  id: z.string(),
  outcome: z.object({ logs: z.array(z.string()), executor_id: z.string(), status: z.unknown() }),
});

export const transactionResponseSchema = z.object({
  status: z.unknown(),
  transaction: z.object({ hash: z.string() }),
  transaction_outcome: z.object({ outcome: z.object({ logs: z.array(z.string()) }) }),
  receipts_outcome: z.array(receiptSchema),
});

export type ChainCall = {
  readonly txHash: string;
  readonly ok: boolean;
  readonly errorCode: string | null;
  readonly events: readonly VaultEvent[];
};

function failureText(status: unknown): string | null {
  if (typeof status !== "object" || status === null || !("Failure" in status)) return null;
  return JSON.stringify(status.Failure);
}

export function readOutcome(response: unknown): ChainCall {
  const parsed = transactionResponseSchema.parse(response);
  const logs = [
    ...parsed.transaction_outcome.outcome.logs,
    ...parsed.receipts_outcome.flatMap((receipt) => receipt.outcome.logs),
  ];
  const failure = failureText(parsed.status);
  return {
    txHash: parsed.transaction.hash,
    ok: failure === null,
    errorCode: failure === null ? null : (/ERR_[A-Z_]+/.exec(failure)?.[0] ?? "ERR_UNKNOWN"),
    events: logs.flatMap((line) => {
      const event = parseEventLog(line);
      return event === null ? [] : [event];
    }),
  };
}
