import { z } from "zod";

export const oneClickApi = "https://1click.chaindefuser.com/v0";
export const wrappedNear = "nep141:wrap.near";

export type PayoutPreference = {
  readonly label: string;
  readonly asset: string;
  readonly recipient: string;
  readonly recipientType: "DESTINATION_CHAIN" | "INTENTS";
};

export const intentQuoteSchema = z.object({
  quote: z.object({
    amountIn: z.string(),
    amountInFormatted: z.string(),
    amountOut: z.string(),
    amountOutFormatted: z.string(),
    amountOutUsd: z.string(),
    minAmountOut: z.string(),
    timeEstimate: z.number(),
  }),
  signature: z.string(),
  timestamp: z.string(),
  correlationId: z.string(),
});
export type IntentQuote = z.infer<typeof intentQuoteSchema>;

export type QuoteRequest = {
  readonly amountYocto: bigint;
  readonly preference: PayoutPreference;
  readonly refundTo: string;
  readonly deadline: Date;
};

export function quoteBody(request: QuoteRequest): Record<string, unknown> {
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: wrappedNear,
    depositType: "INTENTS",
    amount: request.amountYocto.toString(),
    destinationAsset: request.preference.asset,
    recipient: request.preference.recipient,
    recipientType: request.preference.recipientType,
    refundTo: request.refundTo,
    refundType: "INTENTS",
    deadline: request.deadline.toISOString(),
    quoteWaitingTimeMs: 3_000,
  };
}

export type IntentQuoter = (request: QuoteRequest) => Promise<IntentQuote>;

export function oneClickQuoter(baseUrl: string = oneClickApi): IntentQuoter {
  return async (request) => {
    const response = await fetch(`${baseUrl}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quoteBody(request)),
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = z.object({ message: z.string() }).safeParse(body);
      throw new Error(
        `NEAR Intents refused the quote: ${message.success ? message.data.message : String(response.status)}`,
      );
    }
    return intentQuoteSchema.parse(body);
  };
}
