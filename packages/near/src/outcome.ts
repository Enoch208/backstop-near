import { z } from "zod";
import { parseEventLog, type VaultEvent } from "./wire.js";

const receiptSchema = z.object({
  id: z.string(),
  outcome: z.object({ logs: z.array(z.string()), executor_id: z.string(), status: z.unknown() }),
});

export const transactionResponseSchema = z.object({
  status: z.unknown(),
  transaction: z.object({ hash: z.string(), signer_id: z.string() }),
  transaction_outcome: z.object({ outcome: z.object({ logs: z.array(z.string()) }) }),
  receipts_outcome: z.array(receiptSchema),
});

export type ChainCall = {
  readonly txHash: string;
  readonly signer: string;
  readonly ok: boolean;
  readonly errorCode: string | null;
  readonly events: readonly VaultEvent[];
  readonly vaultEvents?: Readonly<Record<string, readonly VaultEvent[]>>;
};

function failureText(status: unknown): string | null {
  if (typeof status !== "object" || status === null || !("Failure" in status)) return null;
  return JSON.stringify(status.Failure);
}

export function readOutcome(response: unknown): ChainCall {
  const parsed = transactionResponseSchema.parse(response);
  const failure = failureText(parsed.status);
  const vaultEvents: Record<string, VaultEvent[]> = Object.create(null) as Record<
    string,
    VaultEvent[]
  >;
  const events = parsed.transaction_outcome.outcome.logs.flatMap((line) => {
    const event = parseEventLog(line);
    return event === null ? [] : [event];
  });
  for (const { outcome } of parsed.receipts_outcome) {
    for (const line of outcome.logs) {
      const event = parseEventLog(line);
      if (event === null) continue;
      events.push(event);
      if (failureText(outcome.status) === null)
        (vaultEvents[outcome.executor_id] ??= []).push(event);
    }
  }
  return {
    txHash: parsed.transaction.hash,
    signer: parsed.transaction.signer_id,
    ok: failure === null,
    errorCode: failure === null ? null : (/ERR_[A-Z_]+/.exec(failure)?.[0] ?? "ERR_UNKNOWN"),
    vaultEvents,
    events,
  };
}
