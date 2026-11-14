import { describe, expect, it } from "vitest";
import { principals, roster, signBid } from "@backstop/agents";
import { candidate, checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { digestOf, near, sha256Hex, toYocto } from "@backstop/shared";
import { addressOfSecret, signPersonal, type InferenceReceipt } from "@backstop/tee";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { asPrincipal } from "@backstop/agents";
import { call, read, testRuntime } from "./support.js";

const taskId = "checkout-tee";
const model = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const enclave = sha256(utf8ToBytes("stand-in enclave key"));
const source = candidate("gamma-integer").source;

function receipt(content: string, secret = enclave): InferenceReceipt {
  const requestBody = JSON.stringify({ model, messages: [{ role: "user", content: "repair" }] });
  const responseBody = JSON.stringify({ id: "chat-7", choices: [{ message: { content } }] });
  const signedText = `${model}:${sha256Hex(requestBody)}:${sha256Hex(responseBody)}`;
  return {
    provider: "near-ai-cloud",
    model,
    chatId: "chat-7",
    requestBody,
    responseBody,
    signedText,
    signature: signPersonal(signedText, secret),
    signingAddress: addressOfSecret(secret),
  };
}

async function assigned() {
  const { runtime, clock } = testRuntime();
  runtime.teeSigners.set(addressOfSecret(enclave), model);
  const fund = (pool: string, amount: string) => ({
    pool,
    amountYocto: toYocto(near(amount)),
    liabilityYocto: null,
  });
  await call(runtime, clock, principals.customer, "/api/tasks", {
    manifest: checkoutManifest({
      taskId,
      createdAtMs: clock.now,
      maxAttempts: 3,
      timing: liveTiming,
    }),
  });
  const path = `/api/tasks/${taskId}`;
  await call(runtime, clock, principals.customer, `${path}/funding`, fund("escrow", "0.40"));
  await call(runtime, clock, principals.customer, `${path}/funding`, fund("premium", "0.04"));
  await call(runtime, clock, principals.guarantor, `${path}/funding`, fund("bond", "0.25"));
  const bid = signBid(
    {
      taskId,
      epoch: 0,
      members: [
        {
          agentId: "gamma",
          account: roster.gamma.account,
          role: "repairer",
          shareYocto: toYocto(near("0.30")),
        },
      ],
      amountYocto: toYocto(near("0.30")),
      estimatedDurationMs: 60_000,
      planHash: digestOf("tee primary"),
      committedAtMs: clock.now,
      expiresAtMs: clock.now + 60_000,
    },
    roster.gamma,
  );
  const gamma = asPrincipal(roster.gamma);
  await call(runtime, clock, gamma, `${path}/bids`, { bid });
  await call(runtime, clock, gamma, `${path}/claim`, {});
  const submit = (inference: InferenceReceipt) =>
    call(runtime, clock, gamma, `${path}/artifacts`, {
      fencingToken: 1,
      source,
      checkpointHash: null,
      inference,
    });
  const checkpointWith = (code: string) =>
    call(runtime, clock, gamma, `${path}/checkpoints`, {
      fencingToken: 1,
      checkpoint: {
        taskId,
        attempt: 1,
        stateVersion: 1,
        contentHash: digestOf("not the code"),
        artifactUri: "checkpoint://gamma",
        validatedSubtasks: [],
        provenanceEventIds: [],
        parentCheckpointHash: null,
      },
      source: code,
    });
  return { runtime, submit, checkpointWith };
}

const fenced = (code: string) => `Here is the fix:\n\`\`\`js\n${code}\`\`\``;

describe("TEE-signed inference at the artifact door", () => {
  it("puts a verified NEAR AI receipt into the verifier's signed evidence", async () => {
    const { runtime, submit } = await assigned();
    expect((await submit(receipt(fenced(source)))).status).toBe(201);
    const task = await read(runtime, `/api/tasks/${taskId}`);
    expect(task.body).toMatchObject({
      task: {
        candidate: {
          evidence: {
            body: {
              verdict: "ACCEPT",
              inference: { model, signingAddress: addressOfSecret(enclave), chatId: "chat-7" },
            },
          },
        },
      },
    });
  });

  it("refuses a receipt signed by a key no enclave attested", async () => {
    const { submit } = await assigned();
    const forged = receipt(fenced(source), sha256(utf8ToBytes("laptop key")));
    expect(await submit(forged)).toMatchObject({
      status: 422,
      body: { error: { message: expect.stringContaining("not an attested signer") as unknown } },
    });
  });

  it("refuses a genuine receipt for a reply that holds other code", async () => {
    const { submit } = await assigned();
    const other = receipt(fenced(candidate("beta-boundary").source));
    expect(await submit(other)).toMatchObject({
      status: 422,
      body: { error: { message: expect.stringContaining("holds other code") as unknown } },
    });
  });

  it("refuses a checkpoint whose published source does not hash to its contentHash", async () => {
    const { checkpointWith } = await assigned();
    expect(await checkpointWith(source)).toMatchObject({
      status: 422,
      body: { error: { message: expect.stringContaining("does not hash") as unknown } },
    });
  });
});
