import { readFileSync } from "node:fs";
import {
  appendTestnetEntry,
  chainOptionsFromEnv,
  codeHashOf,
  defaultTestnetRpc,
  explorerTx,
  getRoles,
  parseKey,
  partyFunding,
  publishedCodeHash,
  testnetParty,
  testnetRoot,
  upgradeVault,
} from "@backstop/near";

const out = (line: string) => process.stdout.write(`${line}\n`);
const wasmPath = process.argv[2];
if (wasmPath === undefined) {
  out("Usage: pnpm vault:upgrade <outcome_vault.wasm from CI or the Linux container build>");
  process.exit(2);
}
const options = chainOptionsFromEnv("testnet", process.env);
if (options.network !== "testnet") throw new Error("Upgrades run on testnet only");
const root = testnetRoot(
  options.account,
  options.privateKey === null ? null : parseKey(options.privateKey),
  options.rpc ?? defaultTestnetRpc,
);
const vault = await testnetParty(root, "vault", partyFunding.vault ?? 0n);
const wasm = readFileSync(wasmPath);
const target = codeHashOf(wasm);
if (target !== publishedCodeHash()) {
  out(`Refusing: ${wasmPath} hashes to ${target}, not the published reproducible build`);
  process.exit(1);
}
const before = (await vault.getState()).codeHash;
if (before === target) {
  out(`${vault.accountId} already runs ${target}`);
  process.exit(0);
}
out(`Upgrading ${vault.accountId} from ${before} to ${target} and migrating its state`);
const call = await upgradeVault(vault, wasm);
const roles = await getRoles({ contractId: vault.accountId }, vault);
out(`${call.ok ? "ok" : `refused ${call.errorCode ?? ""}`} ${explorerTx(call.txHash)}`);
out(`Roles after the upgrade: ${JSON.stringify(roles)}`);
if (call.ok)
  appendTestnetEntry(vault.accountId, "upgrades", {
    txHash: call.txHash,
    from: before,
    to: target,
  });
process.exit(call.ok ? 0 : 1);
