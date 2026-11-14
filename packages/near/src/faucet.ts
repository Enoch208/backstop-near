import type { KeyPair } from "near-api-js";

export const testnetFaucet = "https://helper.nearprotocol.com/account";

export async function requestFaucetAccount(
  accountId: string,
  keyPair: KeyPair,
  faucetUrl: string = testnetFaucet,
): Promise<{ ok: boolean; status: number; detail: string }> {
  const response = await fetch(faucetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: keyPair.getPublicKey().toString(),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const detail = (await response.text()).slice(0, 400);
  return { ok: response.ok, status: response.status, detail };
}
