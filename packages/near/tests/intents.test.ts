import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { near } from "@backstop/shared";
import { oneClickQuoter, quoteBody, type PayoutPreference } from "../src/index.js";

const preference: PayoutPreference = {
  label: "USDC on Base",
  asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  recipient: "0x6cf8227bbe2ef5f0b7bfd9aa62c3fd3da19d4d22",
  recipientType: "DESTINATION_CHAIN",
};

const recorded = {
  quote: {
    amountIn: "120000000000000000000000",
    amountInFormatted: "0.12",
    amountInUsd: "0.4008",
    minAmountIn: "120000000000000000000000",
    amountOut: "397941",
    amountOutFormatted: "0.397941",
    amountOutUsd: "0.397772273016",
    minAmountOut: "393961",
    timeEstimate: 14,
  },
  signature: "ed25519:recorded",
  timestamp: "2026-11-14T12:31:50.245Z",
  correlationId: "recorded",
};

let server: Server | null = null;
let seen: unknown = null;

async function fake(status: number, body: unknown): Promise<string> {
  server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString()));
    request.on("end", () => {
      seen = JSON.parse(text) as unknown;
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${String(address.port)}`;
}

afterEach(() => {
  server?.close();
  server = null;
});

describe("NEAR Intents payout quotes", () => {
  const request = {
    amountYocto: near("0.12"),
    preference,
    refundTo: "backstop-vault.near",
    deadline: new Date("2026-11-14T13:00:00Z"),
  };

  it("asks only for a dry quote, from wNEAR held in Intents, for the exact payout", () => {
    expect(quoteBody(request)).toMatchObject({
      dry: true,
      originAsset: "nep141:wrap.near",
      depositType: "INTENTS",
      amount: "120000000000000000000000",
      destinationAsset: preference.asset,
      recipient: preference.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: "backstop-vault.near",
    });
  });

  it("returns the signed quote the service answers with", async () => {
    const quote = await oneClickQuoter(await fake(201, recorded))(request);
    expect(quote.quote.amountOutFormatted).toBe("0.397941");
    expect(quote.signature).toBe("ed25519:recorded");
    expect(seen).toMatchObject({ dry: true });
  });

  it("surfaces the service's refusal instead of inventing a quote", async () => {
    const quoter = oneClickQuoter(await fake(400, { message: "recipient is not valid" }));
    await expect(quoter(request)).rejects.toThrow("recipient is not valid");
  });
});
