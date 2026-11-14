import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofProvider } from "../src/proof-provider.js";
import { testnetProofProvider } from "../src/verify.js";

const params = {
  request_type: "view_account",
  account_id: "vault.testnet",
  finality: "final",
} as const;
const success = () => Response.json({ jsonrpc: "2.0", id: "1", result: { proof: "fresh" } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("public proof RPC retry policy", () => {
  it.each([408, 429, 500, 502, 503])(
    "backs off HTTP %i then returns only the successful read",
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response("temporarily unavailable", { status }))
        .mockResolvedValueOnce(success());
      vi.stubGlobal("fetch", fetch);
      const provider = new ProofProvider(["https://first.test", "https://second.test"]);
      const pending = provider.sendJsonRpc("query", params);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ proof: "fresh" });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        "https://first.test",
        "https://second.test",
      ]);
    },
  );

  it("fails closed after six rate-limited reads with bounded exponential delays", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(new Response("limited", { status: 429 })));
    vi.stubGlobal("fetch", fetch);
    const provider = testnetProofProvider("https://custom.test");
    const pending = expect(
      provider.viewAccount({ accountId: "vault.testnet" }),
    ).rejects.toMatchObject({ cause: 429 });
    await vi.runAllTimersAsync();
    await pending;
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient network failure and preserves a later nonretryable RPC error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }))
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: "1",
          error: { code: -32602, message: "Invalid params" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const provider = new ProofProvider(["https://rpc.test"]);
    const pending = expect(provider.sendJsonRpc("query", params)).rejects.toThrow();
    await vi.runAllTimersAsync();
    await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["rpc", "malformed", "network-permanent"] as const)(
    "does not retry %s errors",
    async (kind) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      if (kind === "network-permanent") fetch.mockRejectedValue(new Error("certificate invalid"));
      else
        fetch.mockResolvedValue(
          kind === "malformed"
            ? Response.json({})
            : Response.json({
                jsonrpc: "2.0",
                id: "1",
                error: { code: -32602, message: "Invalid params" },
              }),
        );
      vi.stubGlobal("fetch", fetch);
      const provider = new ProofProvider(["https://first.test", "https://second.test"]);
      await expect(provider.sendJsonRpc("query", params)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("retries transaction-status reads but never retries a transaction submission", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("limited", { status: 429 }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetch);
    const provider = new ProofProvider(["https://first.test", "https://second.test"]);
    const pending = provider.sendJsonRpc("tx", {
      tx_hash: "hash",
      sender_account_id: "worker.testnet",
      wait_until: "FINAL",
    });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ proof: "fresh" });
    fetch.mockReset().mockResolvedValue(new Response("limited", { status: 429 }));
    await expect(
      provider.sendJsonRpc("send_tx", { signed_tx_base64: "AA==", wait_until: "FINAL" }),
    ).rejects.toMatchObject({ cause: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
