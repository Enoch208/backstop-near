import { sha256Hex, type AttestedInference } from "@backstop/shared";
import { z } from "zod";
import { addressSchema, ethSignatureSchema, recoverSigner } from "./eth.js";

export const inferenceReceiptSchema = z.strictObject({
  provider: z.literal("near-ai-cloud"),
  model: z.string().min(1).max(128),
  chatId: z.string().min(1).max(256),
  requestBody: z.string().min(1).max(262_144),
  responseBody: z.string().min(1).max(262_144),
  signedText: z.string().min(1).max(512),
  signature: ethSignatureSchema,
  signingAddress: addressSchema,
});
export type InferenceReceipt = z.infer<typeof inferenceReceiptSchema>;

export type TrustedSigners = ReadonlyMap<string, string>;

export type ReceiptCheck =
  | { readonly ok: true; readonly inference: AttestedInference; readonly content: string }
  | { readonly ok: false; readonly reason: string };

const requestSchema = z.object({ model: z.string() });
const responseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

function parseJson<T>(schema: z.ZodType<T>, text: string): T | null {
  const parsed = z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({ code: "custom", message: "not JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema)
    .safeParse(text);
  return parsed.success ? parsed.data : null;
}

function hashesOf(receipt: InferenceReceipt): { request: string; response: string } | string {
  const parts = receipt.signedText.split(":");
  if (parts.length === 3 && parts[0] !== receipt.model)
    return "the signed text names another model";
  if (parts.length !== 2 && parts.length !== 3) return "the signed text is not hash:hash";
  const [request, response] = parts.slice(-2);
  return request === undefined || response === undefined
    ? "the signed text is incomplete"
    : { request, response };
}

function recovered(receipt: InferenceReceipt): string | null {
  try {
    return recoverSigner(receipt.signedText, receipt.signature);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export function checkReceipt(receipt: InferenceReceipt, trusted: TrustedSigners): ReceiptCheck {
  const refuse = (reason: string): ReceiptCheck => ({ ok: false, reason });
  const hashes = hashesOf(receipt);
  if (typeof hashes === "string") return refuse(hashes);
  if (hashes.request !== sha256Hex(receipt.requestBody))
    return refuse("the request body does not match the signed request hash");
  if (hashes.response !== sha256Hex(receipt.responseBody))
    return refuse("the response body does not match the signed response hash");
  const request = parseJson(requestSchema, receipt.requestBody);
  if (request?.model !== receipt.model) return refuse("the request asked for another model");
  const response = parseJson(responseSchema, receipt.responseBody);
  if (response === null) return refuse("the response is not a chat completion");
  if (response.id !== receipt.chatId) return refuse("the response belongs to another chat");
  const signer = recovered(receipt);
  if (signer === null) return refuse("the signature does not recover a key");
  if (signer !== receipt.signingAddress) return refuse("the signature recovers another key");
  if (trusted.get(signer) !== receipt.model)
    return refuse(`${signer} is not an attested signer for ${receipt.model}`);
  const content = response.choices[0]?.message.content ?? "";
  return {
    ok: true,
    content,
    inference: {
      provider: receipt.provider,
      model: receipt.model,
      chatId: receipt.chatId,
      signingAddress: signer,
      requestHash: `sha256:${hashes.request}`,
      responseHash: `sha256:${hashes.response}`,
      signedText: receipt.signedText,
      signature: receipt.signature,
    },
  };
}
