import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { near, sha256Hex } from "@backstop/shared";
import { addressOfSecret, signPersonal } from "@backstop/tee";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { Account } from "near-api-js";
import {
  createTask,
  deployVault,
  ensureSubAccounts,
  fundPremium,
  getInference,
  getTeeSigner,
  postGuarantee,
  recordAttestedVerdict,
  registerAssignment,
  registerTeeSigner,
  startLocalChain,
  type LocalChain,
  type Vault,
} from "../src/index.js";

const parties = ["vault", "customer", "guarantor", "coordinator", "verifier", "gamma"] as const;
const model = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const enclave = sha256(utf8ToBytes("sandbox enclave key"));
const signer = addressOfSecret(enclave);
const zero = "0".repeat(64);

let chain: LocalChain;
let accounts: Record<string, Account>;
let vault: Vault;

const party = (name: string): Account => {
  const account = accounts[name];
  if (account === undefined) throw new Error(`No account ${name}`);
  return account;
};

const signedText = `${model}:${sha256Hex("request")}:${sha256Hex("response")}`;

async function assignedTask(taskId: string) {
  const deadlineNs = BigInt(Date.now() + 3_600_000) * 1_000_000n;
  const policy = { deadlineNs, maxAttempts: 2, compensationCap: near("0.1") };
  await createTask(vault, party("customer"), taskId, zero, policy, near("0.4"));
  await fundPremium(vault, party("customer"), taskId, near("0.04"));
  await postGuarantee(vault, party("guarantor"), taskId, near("0.25"), near("0.25"));
  const assigned = await registerAssignment(vault, party("coordinator"), taskId, {
    attempt: 1,
    agent: party("gamma").accountId,
    bidHash: zero,
    payees: [{ account: party("gamma").accountId, amount: near("0.3") }],
  });
  expect(assigned.ok).toBe(true);
}

const attested = (taskId: string, text: string, signature: string) =>
  recordAttestedVerdict(vault, party("verifier"), taskId, {
    attempt: 1,
    artifactHash: "ab".repeat(32),
    suiteHash: zero,
    evidenceHash: zero,
    signedText: text,
    signature,
  });

beforeAll(async () => {
  chain = await startLocalChain();
  accounts = await ensureSubAccounts(chain.root, parties, (name) =>
    name === "vault" ? near("10") : near("5"),
  );
  const deployed = await deployVault(party("vault"), {
    owner: party("vault").accountId,
    coordinator: party("coordinator").accountId,
    verifier: party("verifier").accountId,
  });
  vault = deployed.vault;
  const registered = await registerTeeSigner(vault, party("vault"), signer, model, "cd".repeat(32));
  expect(registered.events.map((event) => event.event)).toEqual(["tee_signer_registered"]);
});

afterAll(async () => {
  await chain.stop();
});

describe("TEE-attested verdicts on a local NEAR node", () => {
  it("recovers the enclave key with ecrecover and records the inference with the ACCEPT", async () => {
    await assignedTask("checkout-tee");
    const call = await attested("checkout-tee", signedText, signPersonal(signedText, enclave));
    expect(call.ok).toBe(true);
    expect(call.events.map((event) => event.event)).toEqual([
      "verdict_recorded",
      "inference_attested",
    ]);
    expect(await getInference(vault, party("customer"), "checkout-tee", 1)).toMatchObject({
      model,
      signer,
      artifact_hash: "ab".repeat(32),
      response_hash: sha256Hex("response"),
    });
    expect(await getTeeSigner(vault, party("customer"), signer)).toMatchObject({ model });
  });

  it("refuses a signature from a key that was never attested, and leaves the task assigned", async () => {
    await assignedTask("checkout-forged");
    const laptop = sha256(utf8ToBytes("a laptop key"));
    const forged = await attested("checkout-forged", signedText, signPersonal(signedText, laptop));
    expect(forged).toMatchObject({ ok: false, errorCode: "ERR_UNKNOWN_TEE_SIGNER" });
    expect(await getInference(vault, party("customer"), "checkout-forged", 1)).toBeNull();
  });

  it("lets only the owner register an enclave key", async () => {
    const call = await registerTeeSigner(vault, party("verifier"), signer, model, zero);
    expect(call).toMatchObject({ ok: false, errorCode: "ERR_NOT_OWNER" });
  });
});
