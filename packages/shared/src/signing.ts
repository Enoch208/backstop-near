import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { hexSchema } from "./ids.js";

export const signatureSchema = z.strictObject({
  scheme: z.literal("ed25519"),
  publicKey: hexSchema.length(64),
  signature: hexSchema.length(128),
});
export type Signature = z.infer<typeof signatureSchema>;

export type SigningKey = { readonly secretKey: Uint8Array; readonly publicKey: string };

export function signingKeyFromSeed(seed: string): SigningKey {
  const secretKey = sha256(utf8ToBytes(seed));
  return { secretKey, publicKey: bytesToHex(ed25519.getPublicKey(secretKey)) };
}

export function signValue(value: unknown, key: SigningKey): Signature {
  const message = utf8ToBytes(canonicalJson(value));
  return {
    scheme: "ed25519",
    publicKey: key.publicKey,
    signature: bytesToHex(ed25519.sign(message, key.secretKey)),
  };
}

export function verifyValue(value: unknown, signature: Signature): boolean {
  const message = utf8ToBytes(canonicalJson(value));
  return ed25519.verify(hexToBytes(signature.signature), message, hexToBytes(signature.publicKey));
}
