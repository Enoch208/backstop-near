import { near } from "@backstop/shared";
import {
  appendTestnetEntry,
  chainOptionsFromEnv,
  defaultTestnetRpc,
  explorerTx,
  keyGrants,
  parseKey,
  partyFunding,
  promoteStagedKey,
  restrictToVault,
  stageKey,
  testnetParty,
  testnetRoot,
  type RestrictedRole,
} from "@backstop/near";
import { KeyPair } from "near-api-js";

const out = (line: string) => process.stdout.write(`${line}\n`);
const options = chainOptionsFromEnv("testnet", process.env);
if (options.network !== "testnet") throw new Error("Hardening runs on testnet only");
const root = testnetRoot(
  options.account,
  options.privateKey === null ? null : parseKey(options.privateKey),
  options.rpc ?? defaultTestnetRpc,
);
const vaultId = `vault.${root.accountId}`;
const roles: readonly { readonly party: string; readonly role: RestrictedRole }[] = [
  { party: "coordinator", role: "coordinator" },
  { party: "verifier", role: "verifier" },
  { party: "vault", role: "owner" },
];

for (const { party, role } of roles) {
  const account = await testnetParty(root, party, partyFunding[party] ?? 0n);
  const grants = await keyGrants(account);
  if (grants.every((grant) => grant.kind === "function-call")) {
    out(`${account.accountId} already holds only function-call keys`);
    continue;
  }
  const keyPair = KeyPair.fromRandom("ed25519");
  stageKey("testnet", account.accountId, keyPair);
  const restriction = await restrictToVault(account, vaultId, role, near("1"), keyPair);
  out(
    `${account.accountId}: ${restriction.call.ok ? "ok" : `refused ${restriction.call.errorCode ?? ""}`} ${explorerTx(restriction.call.txHash)}`,
  );
  if (!restriction.call.ok) process.exit(1);
  promoteStagedKey("testnet", account.accountId, "full-access-deleted");
  appendTestnetEntry(vaultId, "keyRestrictions", {
    txHash: restriction.call.txHash,
    account: account.accountId,
    role,
    publicKey: keyPair.getPublicKey().toString(),
  });
}
