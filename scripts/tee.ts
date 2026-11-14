import { defaultModel } from "@backstop/agents";
import {
  appendTestnetEntry,
  chainOptionsFromEnv,
  defaultTestnetRpc,
  explorerTx,
  parseKey,
  partyFunding,
  registerTeeSigner,
  testnetParty,
  testnetRoot,
  toHex32,
} from "@backstop/near";
import { liveAttestation, signerRecord } from "@backstop/tee";

const out = (line: string) => process.stdout.write(`${line}\n`);
const command = process.argv[2] ?? "attest";
const model = process.argv[3] ?? defaultModel;
if (command !== "attest" && command !== "register") {
  out("Usage: pnpm tee attest [model] | pnpm tee register [model]");
  process.exit(2);
}

out(`Attesting ${model} on NEAR AI Cloud with a fresh nonce (no API key needed)`);
const attestation = await liveAttestation(model);
for (const finding of attestation.findings)
  out(`  ${finding.ok ? "ok  " : "FAIL"} ${finding.subject}: ${finding.detail}`);
out(
  attestation.signers.length === 0
    ? "No signing key passed every check; nothing is trusted."
    : `Attested signing key(s) for ${model}: ${attestation.signers.join(", ")} (${attestation.attestationHash})`,
);
if (command === "attest" || attestation.signers.length === 0)
  process.exit(attestation.signers.length === 0 ? 1 : 0);

const options = chainOptionsFromEnv("testnet", process.env);
if (options.network !== "testnet") throw new Error("Registration runs on testnet only");
const root = testnetRoot(
  options.account,
  options.privateKey === null ? null : parseKey(options.privateKey),
  options.rpc ?? defaultTestnetRpc,
);
const vault = await testnetParty(root, "vault", partyFunding.vault ?? 0n);
for (const signer of attestation.signers) {
  const call = await registerTeeSigner(
    { contractId: vault.accountId },
    vault,
    signer,
    model,
    toHex32(attestation.attestationHash),
  );
  out(
    `register ${signer}: ${call.ok ? "ok" : `refused ${call.errorCode ?? ""}`} ${explorerTx(call.txHash)}`,
  );
  if (!call.ok) process.exit(1);
  appendTestnetEntry(vault.accountId, "teeSigners", {
    txHash: call.txHash,
    ...signerRecord(attestation, signer),
  });
}
