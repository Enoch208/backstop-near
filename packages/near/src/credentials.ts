import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair, type KeyPairString } from "near-api-js";
import { z } from "zod";

const keyPairString = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);

const credentialSchema = z.object({
  account_id: z.string(),
  public_key: z.string(),
  private_key: keyPairString,
});

export function credentialsPath(network: string, accountId: string): string {
  return join(homedir(), ".near-credentials", network, `${accountId}.json`);
}

function asKeyPairString(value: string): KeyPairString {
  return `ed25519:${keyPairString.parse(value).slice("ed25519:".length)}`;
}

export function loadKey(network: string, accountId: string): KeyPairString | null {
  const path = credentialsPath(network, accountId);
  if (!existsSync(path)) return null;
  const credential = credentialSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return asKeyPairString(credential.private_key);
}

export function saveKey(
  network: string,
  accountId: string,
  keyPair: KeyPair,
  path = credentialsPath(network, accountId),
): void {
  mkdirSync(join(homedir(), ".near-credentials", network), { recursive: true, mode: 0o700 });
  const credential = {
    account_id: accountId,
    public_key: keyPair.getPublicKey().toString(),
    private_key: keyPair.toString(),
  };
  writeFileSync(path, `${JSON.stringify(credential)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

export function parseKey(value: string): KeyPairString {
  return asKeyPairString(value);
}

const stagedPath = (network: string, accountId: string) =>
  credentialsPath(network, accountId).replace(/\.json$/, ".next.json");

export function stageKey(network: string, accountId: string, keyPair: KeyPair): void {
  saveKey(network, accountId, keyPair, stagedPath(network, accountId));
}

export function promoteStagedKey(network: string, accountId: string, retiredAs: string): void {
  const current = credentialsPath(network, accountId);
  const retired = current.replace(/\.json$/, `.${retiredAs}.json`);
  if (existsSync(retired)) throw new Error(`${retired} already exists`);
  renameSync(current, retired);
  renameSync(stagedPath(network, accountId), current);
}
