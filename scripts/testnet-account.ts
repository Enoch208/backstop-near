import { randomBytes } from "node:crypto";
import { credentialsPath, defaultTestnetRpc, requestFaucetAccount, saveKey } from "@backstop/near";
import { formatNear } from "@backstop/shared";
import { JsonRpcProvider, KeyPair } from "near-api-js";

const out = (line: string) => process.stdout.write(`${line}\n`);
const accountId = process.argv[2] ?? `backstop-${randomBytes(3).toString("hex")}.testnet`;
const provider = new JsonRpcProvider({
  url: process.env.BACKSTOP_TESTNET_RPC ?? defaultTestnetRpc,
});

const keyPair = KeyPair.fromRandom("ed25519");
saveKey("testnet", accountId, keyPair);
out(`Key for ${accountId} saved to ${credentialsPath("testnet", accountId)} (mode 0600)`);

const faucet = await requestFaucetAccount(accountId, keyPair);
out(`Faucet answered HTTP ${String(faucet.status)}`);
if (!faucet.ok) {
  out(faucet.detail);
  process.exit(1);
}

for (let tries = 0; tries < 30; tries += 1) {
  const account = await provider.viewAccount({ accountId }).catch((error: unknown) => {
    if (error instanceof Error && /does not exist/i.test(error.message)) return null;
    throw error;
  });
  if (account !== null) {
    out(`${accountId} exists with ${formatNear(account.amount)} NEAR`);
    out(`Next: BACKSTOP_TESTNET_ACCOUNT=${accountId} pnpm chain testnet`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
out(`${accountId} did not appear within a minute`);
process.exit(1);
