import { z } from "zod";
import published from "../../../../contracts/outcome-vault/outcome_vault.wasm.sha256?raw";
import { ledgerSchema, rpc } from "../data/near.js";
import { enclaveKey, liveRun, record, type RecordedStep } from "../data/record.js";
import { recordedReceipt, recoverSigner } from "./receipt.js";

export type Tamper = "none" | "settled-twice" | "paid-more" | "other-key" | "forged-receipt";

export type Check = {
  readonly id: string;
  readonly group:
    "Code" | "Enclave key" | "AI receipt" | "Attacks refused on chain" | "Transactions" | "Ledgers";
  readonly label: string;
  readonly ok: boolean;
  readonly unread?: boolean;
  readonly detail: string;
  readonly link: string | null;
};

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(hex: string): string {
  let value = BigInt(`0x${hex}`);
  let out = "";
  while (value > 0n) {
    out = `${alphabet[Number(value % 58n)] ?? ""}${out}`;
    value /= 58n;
  }
  const zeros = /^(00)*/.exec(hex)?.[0].length ?? 0;
  return `${"1".repeat(zeros / 2)}${out}`;
}

const resultSchema = z.object({ result: z.unknown().optional(), error: z.unknown().optional() });

const endpoints = [rpc, "https://rpc.testnet.near.org"];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Unreadable extends Error {}

async function call(method: string, params: unknown): Promise<unknown> {
  let last = "no answer";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const endpoint = endpoints[attempt % endpoints.length] ?? rpc;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
      });
      if (response.status === 429 || response.status >= 500)
        throw new Error(`HTTP ${String(response.status)}`);
      const parsed = resultSchema.parse(await response.json());
      if (parsed.result === undefined) throw new Error(JSON.stringify(parsed.error).slice(0, 160));
      return parsed.result;
    } catch (error) {
      last = error instanceof Error ? error.message : "no answer";
      await pause(300 * 2 ** attempt);
    }
  }
  throw new Unreadable(last);
}

const bytesSchema = z.object({ result: z.array(z.number()) });

async function viewVault(method: string, args: Record<string, unknown>): Promise<unknown> {
  const answer = bytesSchema.parse(
    await call("query", {
      request_type: "call_function",
      finality: "final",
      account_id: record.contractId,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    }),
  );
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(answer.result))) as unknown;
}

const root = record.contractId.slice(record.contractId.indexOf(".") + 1);
const roles = ["customer", "guarantor", "coordinator", "verifier"];

function signerOf(step: RecordedStep): string {
  if (step.signer !== undefined) return step.signer;
  const role = roles.find((name) => step.label.toLowerCase().startsWith(name)) ?? "coordinator";
  return `${role}.${root}`;
}

const statusSchema = z.object({ status: z.unknown() });

async function chainOutcome(step: RecordedStep): Promise<string> {
  const result = statusSchema.parse(
    await call("tx", {
      tx_hash: step.txHash,
      sender_account_id: signerOf(step),
      wait_until: "FINAL",
    }),
  );
  const status = result.status;
  if (typeof status === "object" && status !== null && "Failure" in status) {
    const code = /ERR_[A-Z_]+/.exec(JSON.stringify(status))?.[0] ?? "ERR_UNKNOWN";
    return `refused ${code}`;
  }
  return "success";
}

const claimedSteps = (tamper: Tamper): RecordedStep[] =>
  record.runs.flatMap((run) =>
    run.steps.map((step) =>
      tamper === "settled-twice" &&
      run.taskId === liveRun.taskId &&
      step.outcome.startsWith("refused")
        ? { ...step, outcome: "success" }
        : step,
    ),
  );

async function pool<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await work(item);
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function runChecks(tamper: Tamper, onCheck: (check: Check) => void): Promise<void> {
  const account = z.object({ code_hash: z.string() }).parse(
    await call("query", {
      request_type: "view_account",
      finality: "final",
      account_id: record.contractId,
    }),
  );
  const expected = base58(published.slice(0, 64));
  onCheck({
    id: "code",
    group: "Code",
    label: "The vault runs the published reproducible build",
    ok: account.code_hash === expected,
    detail: `${record.contractId} runs ${account.code_hash}; published ${expected}`,
    link: `https://testnet.nearblocks.io/address/${record.contractId}`,
  });

  const claimedKey =
    tamper === "other-key"
      ? "0x0000000000000000000000000000000000000001"
      : enclaveKey.signingAddress;
  const signer = z
    .object({ model: z.string() })
    .nullable()
    .parse((await viewVault("get_tee_signer", { address: claimedKey })) ?? null);
  onCheck({
    id: "enclave",
    group: "Enclave key",
    label: `${claimedKey.slice(0, 10)}… is registered for ${enclaveKey.model}`,
    ok: signer?.model === enclaveKey.model,
    detail: signer === null ? "no such key on the vault" : `vault.get_tee_signer → ${signer.model}`,
    link: enclaveKey.explorer,
  });

  const replayRun = record.runs.at(-1)?.taskId ?? liveRun.taskId;
  const recorded = await recordedReceipt(replayRun);
  if (recorded !== null) {
    const text =
      tamper === "forged-receipt"
        ? recorded.receipt.signedText.replace(/.$/, (last) => (last === "0" ? "1" : "0"))
        : recorded.receipt.signedText;
    const signerKey = recoverSigner(text, recorded.receipt.signature);
    const onChain = z
      .object({ signer: z.string(), response_hash: z.string() })
      .nullable()
      .parse(
        (await viewVault("get_inference", { task_id: replayRun, attempt: recorded.attempt })) ??
          null,
      );
    onCheck({
      id: "receipt",
      group: "AI receipt",
      label: `The AI patch in ${replayRun} was signed by the attested enclave, and the vault recorded the same reply`,
      ok:
        signerKey === enclaveKey.signingAddress &&
        onChain?.signer === signerKey &&
        `sha256:${onChain.response_hash}` === recorded.receipt.responseHash,
      detail: `recovered ${signerKey.slice(0, 12)}… in your browser; vault.get_inference → ${onChain === null ? "none" : `${onChain.signer.slice(0, 12)}…, reply ${onChain.response_hash.slice(0, 10)}…`}`,
      link: null,
    });
  }

  await pool(claimedSteps(tamper), 3, async (step) => {
    const actual = await chainOutcome(step).catch((error: unknown) => {
      if (error instanceof Unreadable) return null;
      throw error;
    });
    onCheck({
      id: step.txHash,
      group: step.label.startsWith("Attack:") ? "Attacks refused on chain" : "Transactions",
      label: step.label,
      ok: actual === step.outcome,
      ...(actual === null ? { unread: true } : {}),
      detail:
        actual === null
          ? "the public RPC did not answer; run again"
          : `claimed ${step.outcome}, chain says ${actual}`,
      link: step.explorer,
    });
  });

  await pool(record.runs, 3, async (run) => {
    const ledger = ledgerSchema
      .nullable()
      .parse((await viewVault("get_ledger", { task_id: run.taskId })) ?? null);
    const claimedOut =
      tamper === "paid-more" && run.taskId === liveRun.taskId
        ? "700000000000000000000000"
        : ledger?.total_inflow;
    const ok =
      ledger !== null &&
      /SETTLED/.test(ledger.state) &&
      ledger.confirmed_outflow === claimedOut &&
      ledger.pending_outflow === "0" &&
      ledger.failed_outflow === "0";
    onCheck({
      id: run.taskId,
      group: "Ledgers",
      label: `${run.taskId} settled, every yoctoNEAR in confirmed out`,
      ok,
      detail:
        ledger === null
          ? "no ledger on chain"
          : `${ledger.state}: in ${ledger.total_inflow}, out ${ledger.confirmed_outflow}${claimedOut === ledger.total_inflow ? "" : `, claimed out ${claimedOut ?? "?"}`}`,
      link: null,
    });
  });
}
