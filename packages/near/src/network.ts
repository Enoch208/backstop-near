import { Account, KeyPair, type KeyPairString } from "near-api-js";
import { loadKey, saveKey } from "./credentials.js";
import { readOutcome } from "./outcome.js";

export const defaultTestnetRpc = "https://test.rpc.fastnear.com";
export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

async function exists(root: Account, accountId: string): Promise<boolean> {
  try {
    await root.provider.viewAccount({ accountId });
    return true;
  } catch (error) {
    if (error instanceof Error && /does not exist|UNKNOWN_ACCOUNT/i.test(error.message))
      return false;
    throw error;
  }
}

export async function testnetParty(root: Account, name: string, fund: bigint): Promise<Account> {
  const accountId = `${name}.${root.accountId}`;
  const known = loadKey("testnet", accountId);
  if (await exists(root, accountId)) {
    if (known === null)
      throw new Error(`${accountId} exists but its key is not in ~/.near-credentials/testnet`);
    return new Account(accountId, root.provider, known);
  }
  const keyPair = KeyPair.fromRandom("ed25519");
  const outcome = readOutcome(
    await root.createSubAccount({
      accountOrPrefix: name,
      publicKey: keyPair.getPublicKey(),
      nearToTransfer: fund,
    }),
  );
  if (!outcome.ok)
    throw new Error(
      `Could not create ${accountId}: ${outcome.errorCode ?? "unknown"} (${outcome.txHash})`,
    );
  saveKey("testnet", accountId, keyPair);
  return new Account(accountId, root.provider, keyPair.toString());
}

export function testnetRoot(
  accountId: string,
  privateKey: KeyPairString | null,
  rpcUrl: string,
): Account {
  const key = privateKey ?? loadKey("testnet", accountId);
  if (key === null) {
    throw new Error(
      `No key for ${accountId}: set BACKSTOP_TESTNET_PRIVATE_KEY or add ~/.near-credentials/testnet/${accountId}.json`,
    );
  }
  return new Account(accountId, rpcUrl, key);
}

export async function topUp(
  root: Account,
  party: Account,
  minimumAvailable: bigint,
): Promise<string | null> {
  const { balance } = await party.getState();
  if (balance.available >= minimumAvailable) return null;
  const outcome = readOutcome(
    await root.transfer({
      receiverId: party.accountId,
      amount: minimumAvailable - balance.available,
    }),
  );
  if (!outcome.ok)
    throw new Error(`Could not top up ${party.accountId}: ${outcome.errorCode ?? "unknown"}`);
  return outcome.txHash;
}
