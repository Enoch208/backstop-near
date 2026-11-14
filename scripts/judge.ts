import { attestationClaim, networkClaims, offlineClaims, type Claim } from "./judge-claims.js";

const out = (line: string) => process.stdout.write(`${line}\n`);
const network = process.argv.includes("--network");
const asJson = process.argv.includes("--json");

const started = Date.now();
const claims: Claim[] = [...offlineClaims(), await attestationClaim()];
if (network) claims.push(...(await networkClaims()));
const passed = claims.filter((claim) => claim.ok).length;

if (asJson) {
  out(JSON.stringify({ passed, total: claims.length, network, claims }, null, 2));
} else {
  out("Backstop judge report");
  out(
    network
      ? "Offline checks run the real state machine, ledger, verifier and TEE code; network checks read NEAR testnet."
      : "Offline checks run the real state machine, ledger, verifier and TEE code. Add --network to re-check NEAR testnet.",
  );
  out("");
  for (const [index, claim] of claims.entries()) {
    out(`${String(index + 1).padStart(2, " ")}. ${claim.ok ? "PASS" : "FAIL"}  ${claim.claim}`);
    out(`          ${claim.evidence}`);
  }
  out("");
  out(
    `${String(passed)} of ${String(claims.length)} claims hold (${String(Date.now() - started)} ms).`,
  );
}
process.exit(passed === claims.length ? 0 : 1);
