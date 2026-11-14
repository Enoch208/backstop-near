import { readFileSync } from "node:fs";
import {
  defaultTestnetRpc,
  testnetRecordSchema,
  verifyLedger,
  verifyStep,
  type Finding,
} from "@backstop/near";
import { baseEncode, JsonRpcProvider } from "near-api-js";

const out = (line: string) => process.stdout.write(`${line}\n`);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const record = testnetRecordSchema.parse(JSON.parse(read("../deployments/testnet.json")));
const provider = new JsonRpcProvider({
  url: process.env.BACKSTOP_TESTNET_RPC ?? defaultTestnetRpc,
});
const root = record.contractId.slice(record.contractId.indexOf(".") + 1);
const findings: Finding[] = [];

out(`Verifying the public testnet record of ${record.contractId} against NEAR testnet`);
const published = baseEncode(
  Buffer.from(read("../contracts/outcome-vault/outcome_vault.wasm.sha256").slice(0, 64), "hex"),
);
const deployed = (await provider.viewAccount({ accountId: record.contractId })).code_hash;
findings.push({
  ok: deployed === published,
  subject: "code",
  detail: `deployed code ${deployed} ${deployed === published ? "is" : "is not"} the published reproducible build ${published}`,
});
for (const run of record.runs) {
  for (const step of run.steps) findings.push(await verifyStep(provider, step, root));
  findings.push(await verifyLedger(provider, record.contractId, run.taskId));
}
for (const finding of findings) out(`  ${finding.ok ? "ok  " : "FAIL"} ${finding.detail}`);
const failed = findings.filter((finding) => !finding.ok);
out(`${String(findings.length - failed.length)} of ${String(findings.length)} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
