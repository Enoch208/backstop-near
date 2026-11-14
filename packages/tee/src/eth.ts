import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((address) => address.toLowerCase());

export const ethSignatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

export function personalDigest(text: string): Uint8Array {
  const body = utf8ToBytes(text);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${String(body.length)}`);
  return keccak_256(concatBytes(prefix, body));
}

export function addressOfPublicKey(publicKey: Uint8Array): string {
  const raw = publicKey.length === 65 ? publicKey.subarray(1) : publicKey;
  if (raw.length !== 64) throw new Error("A secp256k1 public key has 64 raw bytes");
  return `0x${bytesToHex(keccak_256(raw).subarray(12))}`;
}

export function recoverSigner(text: string, signature: string): string {
  const bytes = hexToBytes(ethSignatureSchema.parse(signature).slice(2));
  const v = bytes[64] ?? 0;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery > 1) throw new Error(`The recovery byte ${String(v)} is not 27 or 28`);
  const recovered = concatBytes(Uint8Array.of(recovery), bytes.subarray(0, 64));
  const compressed = secp256k1.recoverPublicKey(recovered, personalDigest(text), {
    prehash: false,
  });
  return addressOfPublicKey(secp256k1.Point.fromBytes(compressed).toBytes(false));
}

export function signPersonal(text: string, secretKey: Uint8Array): string {
  const recovered = secp256k1.sign(personalDigest(text), secretKey, {
    prehash: false,
    format: "recovered",
  });
  const eth = concatBytes(recovered.subarray(1), Uint8Array.of((recovered[0] ?? 0) + 27));
  return `0x${bytesToHex(eth)}`;
}

export function addressOfSecret(secretKey: Uint8Array): string {
  return addressOfPublicKey(secp256k1.getPublicKey(secretKey, false));
}
