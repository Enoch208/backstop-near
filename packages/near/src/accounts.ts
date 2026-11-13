import { Account, KeyPair } from "near-api-js";
import { readOutcome } from "./outcome.js";

export type PartyNames = readonly string[];

export async function ensureSubAccounts(
  root: Account,
  names: PartyNames,
  fund: (name: string) => bigint,
  keyFor: (name: string) => KeyPair = () => KeyPair.fromRandom("ed25519"),
): Promise<Record<string, Account>> {
  const created: Record<string, Account> = {};
  for (const name of names) {
    const keyPair = keyFor(name);
    const accountId = `${name}.${root.accountId}`;
    const outcome = readOutcome(
      await root.createSubAccount({
        accountOrPrefix: name,
        publicKey: keyPair.getPublicKey(),
        nearToTransfer: fund(name),
      }),
    );
    if (!outcome.ok)
      throw new Error(
        `Could not create ${accountId}: ${outcome.errorCode ?? "unknown"} (${outcome.txHash})`,
      );
    created[name] = new Account(accountId, root.provider, keyPair.toString());
  }
  return created;
}
