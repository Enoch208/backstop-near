import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { asset } from "../data/base.js";

export const receiptSchema = z.object({
  model: z.string(),
  signingAddress: z.string(),
  requestHash: z.string(),
  responseHash: z.string(),
  signedText: z.string(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});
export type Receipt = z.infer<typeof receiptSchema>;

export function recoverSigner(text: string, signature: string): string {
  const bytes = hexToBytes(signature.slice(2));
  const v = bytes[64] ?? 0;
  const recovered = concatBytes(Uint8Array.of(v >= 27 ? v - 27 : v), bytes.subarray(0, 64));
  const body = utf8ToBytes(text);
  const digest = keccak_256(
    concatBytes(utf8ToBytes(`\x19Ethereum Signed Message:\n${String(body.length)}`), body),
  );
  const key = secp256k1.recoverPublicKey(recovered, digest, { prehash: false });
  const raw = secp256k1.Point.fromBytes(key).toBytes(false).subarray(1);
  return `0x${bytesToHex(keccak_256(raw).subarray(12))}`;
}

const frameSchema = z.object({
  task: z
    .object({
      task: z.object({
        candidate: z
          .object({
            attempt: z.number(),
            evidence: z
              .object({ body: z.object({ inference: receiptSchema.optional() }) })
              .nullable(),
          })
          .nullable(),
      }),
    })
    .nullable(),
});

export async function recordedReceipt(
  runId: string,
): Promise<{ receipt: Receipt; attempt: number } | null> {
  const response = await fetch(asset(`runs/${runId}.json`));
  if (!response.ok) return null;
  const frames = z.object({ frames: z.array(z.unknown()) }).parse(await response.json()).frames;
  for (const raw of frames) {
    const frame = frameSchema.safeParse(raw);
    const candidate = frame.success ? frame.data.task?.task.candidate : null;
    const receipt = candidate?.evidence?.body.inference;
    if (candidate != null && receipt !== undefined) return { receipt, attempt: candidate.attempt };
  }
  return null;
}
