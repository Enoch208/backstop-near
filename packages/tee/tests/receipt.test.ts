import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  addressOfSecret,
  checkReceipt,
  recoverSigner,
  signPersonal,
  type InferenceReceipt,
} from "../src/index.js";

const model = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const secret = sha256(utf8ToBytes("backstop simulated tee signer"));
const address = addressOfSecret(secret);
const hex = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

function receiptFor(content: string, overrides: Partial<InferenceReceipt> = {}): InferenceReceipt {
  const requestBody = JSON.stringify({ model, messages: [{ role: "user", content: "fix it" }] });
  const responseBody = JSON.stringify({
    id: "chatcmpl-1",
    choices: [{ message: { role: "assistant", content } }],
  });
  const signedText = `${model}:${hex(requestBody)}:${hex(responseBody)}`;
  return {
    provider: "near-ai-cloud",
    model,
    chatId: "chatcmpl-1",
    requestBody,
    responseBody,
    signedText,
    signature: signPersonal(signedText, secret),
    signingAddress: address,
    ...overrides,
  };
}

const trusted = new Map([[address, model]]);

describe("a NEAR AI Cloud inference receipt", () => {
  it("matches the vector the vault contract verifies with ecrecover", () => {
    const text = `${model}:${hex("request")}:${hex("response")}`;
    expect(address).toBe("0x6efa5b49c88d75f66013053f4f89c6fbd319d6d9");
    expect(signPersonal(text, secret)).toBe(
      "0x0d984cd27696e1ca62073c76a50ebebb573ffb053a85f64da205052b7759a21522f12bd116d1761a6da5a5eaf77481295ac3e7bef2e152e204c56b28d3fdd0c41b",
    );
    expect(recoverSigner(text, signPersonal(text, secret))).toBe(address);
  });

  it("is accepted from an attested signer and yields the model's own words", () => {
    const check = checkReceipt(receiptFor("```js\nfunction f() {}\n```"), trusted);
    expect(check).toMatchObject({ ok: true, content: "```js\nfunction f() {}\n```" });
    if (check.ok) expect(check.inference.signingAddress).toBe(address);
  });

  it("is refused when any byte of the request or response changed after signing", () => {
    const honest = receiptFor("original");
    const edited = { ...honest, responseBody: honest.responseBody.replace("original", "edited") };
    expect(checkReceipt(edited, trusted)).toMatchObject({ ok: false });
    const reprompted = { ...honest, requestBody: honest.requestBody.replace("fix", "break") };
    expect(checkReceipt(reprompted, trusted)).toMatchObject({ ok: false });
  });

  it("is refused from a key nobody attested, or attested for another model", () => {
    const stranger = sha256(utf8ToBytes("not in a tee"));
    const honest = receiptFor("x");
    const forged = {
      ...honest,
      signature: signPersonal(honest.signedText, stranger),
      signingAddress: addressOfSecret(stranger),
    };
    expect(checkReceipt(forged, trusted)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not an attested signer") as unknown,
    });
    expect(checkReceipt(honest, new Map([[address, "z-ai/glm-5.3-flash"]]))).toMatchObject({
      ok: false,
    });
  });

  it("is refused when the claimed signer is not the key that signed", () => {
    const honest = receiptFor("x");
    const claimed = { ...honest, signingAddress: "0x0000000000000000000000000000000000000001" };
    expect(checkReceipt(claimed, trusted)).toMatchObject({
      ok: false,
      reason: "the signature recovers another key",
    });
    const garbage = { ...honest, signature: `0x${"00".repeat(64)}1b` };
    expect(checkReceipt(garbage, trusted)).toMatchObject({ ok: false });
  });
});
