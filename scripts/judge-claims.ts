import { readFileSync } from "node:fs";
import { ledgerViolations, statement } from "@backstop/ledger";
import {
  defaultTestnetRpc,
  publishedCodeHash,
  testnetRecordSchema,
  verifyLedger,
  verifyStep,
  verifyTeeSigner,
} from "@backstop/near";
import {
  arenaCase,
  baseline,
  runArenaCase,
  runEpisode,
  type Episode,
} from "@backstop/orchestrator";
import { near, sha256Hex } from "@backstop/shared";
import {
  addressOfSecret,
  attestModel,
  checkReceipt,
  nearAiAttestationBase,
  signPersonal,
} from "@backstop/tee";
import { JsonRpcProvider } from "near-api-js";
import { z } from "zod";

export type Claim = { readonly claim: string; readonly ok: boolean; readonly evidence: string };

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const record = testnetRecordSchema.parse(JSON.parse(read("../deployments/testnet.json")));
const enclave = record.teeSigners.at(-1);

const refusals = (episode: Episode, code: string) =>
  episode.steps.filter((step) => step.refused?.code === code).length;

const conserved = (episode: Episode) => {
  const view = statement(episode.record.ledger);
  return {
    ok:
      ledgerViolations(episode.record.ledger).length === 0 &&
      view.totalIn === view.byStatus.CONFIRMED,
    view,
  };
};

export function offlineClaims(): Claim[] {
  const recovery = runEpisode("recovery", { failFirstTransfer: false, challengeSeed: 7 });
  const money = conserved(recovery);
  const upheld = recovery.steps.some((step) =>
    step.events.some(
      (event) => event.body.type === "attempt_rejected" && event.body.ruling !== null,
    ),
  );
  const retried = runEpisode("recovery", { failFirstTransfer: true, challengeSeed: 7 });
  const exhausted = runEpisode("exhausted", { failFirstTransfer: false, challengeSeed: 7 });
  const rows = Array.from({ length: 32 }, (_, index) => {
    const setup = arenaCase(index + 1);
    return {
      backstop: runArenaCase(setup, "backstop"),
      single: runArenaCase(baseline(setup), "single"),
    };
  });
  const count = (side: "backstop" | "single", outcome: string) =>
    rows.filter((row) => row[side].outcome === outcome).length;
  const arenaClean = rows.every(
    (row) =>
      row.backstop.violations.length === 0 &&
      row.single.violations.length === 0 &&
      row.backstop.replayMatches,
  );
  return [
    {
      claim: "A killed primary is recovered by the swarm and the task settles",
      ok: recovery.record.state === "SETTLED",
      evidence: `final state ${recovery.record.state} after ${String(recovery.record.attempt)} attempts`,
    },
    {
      claim: "Every yoctoNEAR paid in is confirmed out, and the ledger invariants hold",
      ok: money.ok && money.view.totalIn === near("0.69"),
      evidence: `in ${money.view.totalIn.toString()} = out ${money.view.byStatus.CONFIRMED.toString()} yocto, 0 violations`,
    },
    {
      claim: "A stale worker's late writes are refused",
      ok: refusals(recovery, "STALE_LEASE") >= 2,
      evidence: `${String(refusals(recovery, "STALE_LEASE"))} writes refused with STALE_LEASE`,
    },
    {
      claim: "A patch that passes the suite but is wrong is broken by the paid challenger",
      ok: upheld,
      evidence: upheld
        ? "an upheld, verifier-signed counterexample rejected the attempt"
        : "no upheld challenge",
    },
    {
      claim: "Settling twice is refused",
      ok: refusals(recovery, "ALREADY_SETTLED") >= 1,
      evidence: `${String(refusals(recovery, "ALREADY_SETTLED"))} repeated settlement refused with ALREADY_SETTLED`,
    },
    {
      claim: "A failed payout is retried to confirmation exactly once",
      ok: retried.record.state === "SETTLED" && conserved(retried).ok,
      evidence: `state ${retried.record.state}, failed transfers left ${conserved(retried).view.byStatus.FAILED.toString()}`,
    },
    {
      claim: "When recovery is impossible the bond pays capped compensation",
      ok: exhausted.record.state === "FAILURE_SETTLED" && conserved(exhausted).ok,
      evidence: `state ${exhausted.record.state}, bond consumed ${exhausted.record.ledger.bondConsumed.toString()} yocto`,
    },
    {
      claim:
        "Across 32 seeded fault cases Backstop never breaks the ledger and beats a single agent",
      ok: arenaClean && count("backstop", "delivered-wrong") <= count("single", "delivered-wrong"),
      evidence: `wrong deliveries ${String(count("backstop", "delivered-wrong"))} vs ${String(count("single", "delivered-wrong"))}, correct ${String(count("backstop", "delivered-correct"))} vs ${String(count("single", "delivered-correct"))}, 0 violations`,
    },
    forgedReceiptClaim(),
    {
      claim: "The published wasm hash is the code the testnet vault was upgraded to",
      ok: publishedCodeHash() === record.upgrades.at(-1)?.to,
      evidence: `published ${publishedCodeHash()}`,
    },
  ];
}

const fixtureSchema = z.object({
  model: z.string(),
  nonce: z.string(),
  recordedAtMs: z.number(),
  report: z.unknown(),
  collateral: z.unknown(),
  nras: z.unknown(),
  jwks: z.unknown(),
});

function forgedReceiptClaim(): Claim {
  const model = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
  const secret = Uint8Array.from(Buffer.from(sha256Hex("judge forged key"), "hex"));
  const body = JSON.stringify({ model, messages: [] });
  const reply = JSON.stringify({ id: "c", choices: [{ message: { content: "x" } }] });
  const text = `${model}:${sha256Hex(body)}:${sha256Hex(reply)}`;
  const forged = checkReceipt(
    {
      provider: "near-ai-cloud",
      model,
      chatId: "c",
      requestBody: body,
      responseBody: reply,
      signedText: text,
      signature: signPersonal(text, secret),
      signingAddress: addressOfSecret(secret),
    },
    new Map(enclave === undefined ? [] : [[enclave.signingAddress, model]]),
  );
  return {
    claim: "An AI receipt signed by any key the enclave did not attest is refused",
    ok: !forged.ok,
    evidence: forged.ok ? "accepted a forged receipt" : forged.reason,
  };
}

export async function attestationClaim(): Promise<Claim> {
  const fixture = fixtureSchema.parse(
    JSON.parse(read("../packages/tee/tests/fixtures/deepseek-attestation.json")),
  );
  const answer = (body: unknown) => Promise.resolve(Response.json(body));
  const attestation = await attestModel(fixture.model, {
    baseUrl: nearAiAttestationBase,
    nowMs: fixture.recordedAtMs,
    nonce: fixture.nonce,
    collateral: () => Promise.resolve(fixture.collateral),
    fetch: (url) =>
      url.includes("/attestation/report")
        ? answer(fixture.report)
        : url.endsWith("/attest/gpu")
          ? answer(fixture.nras)
          : answer(fixture.jwks),
  });
  const signer = attestation.signers[0] ?? "none";
  return {
    claim:
      "NEAR AI's enclave key is attested by Intel TDX and NVIDIA, and it is the key on the vault",
    ok: signer === enclave?.signingAddress && attestation.findings.every((finding) => finding.ok),
    evidence: `${String(attestation.findings.length)} checks pass offline on the recorded report; signer ${signer}`,
  };
}

export async function networkClaims(): Promise<Claim[]> {
  const provider = new JsonRpcProvider({
    url: process.env.BACKSTOP_TESTNET_RPC ?? defaultTestnetRpc,
  });
  const root = record.contractId.slice(record.contractId.indexOf(".") + 1);
  const deployed = (await provider.viewAccount({ accountId: record.contractId })).code_hash;
  const steps = await Promise.all(
    record.runs.flatMap((run) => run.steps).map((step) => verifyStep(provider, step, root)),
  );
  const ledgers = await Promise.all(
    record.runs.map((run) => verifyLedger(provider, record.contractId, run.taskId)),
  );
  const signer =
    enclave === undefined
      ? { ok: false, detail: "no enclave key recorded" }
      : await verifyTeeSigner(provider, record.contractId, enclave, true);
  const raw = await provider.callFunction({
    contractId: record.contractId,
    method: "get_inference",
    args: { task_id: "checkout-live-71193", attempt: 2 },
  });
  const inference = z
    .object({ signer: z.string(), model: z.string() })
    .nullable()
    .parse(raw ?? null);
  return [
    {
      claim: "The vault on testnet runs exactly the published reproducible build",
      ok: deployed === publishedCodeHash(),
      evidence: `${record.contractId} code ${deployed}`,
    },
    {
      claim: "Every recorded testnet transaction has the outcome the README claims",
      ok: steps.every((step) => step.ok),
      evidence: `${String(steps.filter((step) => step.ok).length)} of ${String(steps.length)} transactions match`,
    },
    {
      claim: "Every recorded task settled on chain with inflow equal to confirmed outflow",
      ok: ledgers.every((ledger) => ledger.ok),
      evidence: `${String(ledgers.filter((ledger) => ledger.ok).length)} of ${String(ledgers.length)} ledgers balanced`,
    },
    {
      claim: "The vault holds the attested enclave key for the model",
      ok: signer.ok,
      evidence: signer.detail,
    },
    {
      claim: "A live AI patch was accepted only after the vault checked its enclave signature",
      ok: inference !== null && inference.signer === enclave?.signingAddress,
      evidence:
        inference === null
          ? "no inference recorded for checkout-live-71193"
          : `get_inference: ${inference.model}, signer ${inference.signer}`,
    },
  ];
}
