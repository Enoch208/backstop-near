import { p384 } from "@noble/curves/nist.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";

export const nvidiaNras = "https://nras.attestation.nvidia.com";

const nrasSchema = z
  .array(z.union([z.tuple([z.literal("JWT"), z.string()]), z.record(z.string(), z.string())]))
  .min(1);
const jwksSchema = z.object({
  keys: z.array(z.object({ kid: z.string(), crv: z.string(), x: z.string(), y: z.string() })),
});
const headerSchema = z.object({ kid: z.string(), alg: z.literal("ES384") });
const claimsSchema = z.object({
  iss: z.string(),
  exp: z.number(),
  eat_nonce: z.string(),
  "x-nvidia-overall-att-result": z.boolean(),
});

export type GpuVerdict = {
  readonly passed: boolean;
  readonly signatureValid: boolean;
  readonly nonceMatches: boolean;
  readonly current: boolean;
  readonly keyId: string;
};

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const fromBase64Url = (part: string): Uint8Array => Uint8Array.from(Buffer.from(part, "base64url"));

const decodeJson = (part: string): unknown =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

async function json(fetcher: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`${url} answered HTTP ${String(response.status)}`);
  return response.json();
}

export async function verifyGpu(
  payload: string,
  nonce: string,
  fetcher: Fetch,
  nowMs: number,
): Promise<GpuVerdict> {
  const answer = nrasSchema.parse(
    await json(fetcher, `${nvidiaNras}/v3/attest/gpu`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    }),
  );
  const first = answer[0];
  const token = Array.isArray(first) ? first[1] : undefined;
  if (token === undefined) throw new Error("NVIDIA returned no platform token");
  const [header, body, signature] = token.split(".");
  if (header === undefined || body === undefined || signature === undefined)
    throw new Error("The NVIDIA token is not a JWT");
  const { kid } = headerSchema.parse(decodeJson(header));
  const claims = claimsSchema.parse(decodeJson(body));
  const keys = jwksSchema.parse(await json(fetcher, `${nvidiaNras}/.well-known/jwks.json`));
  const key = keys.keys.find((candidate) => candidate.kid === kid && candidate.crv === "P-384");
  if (key === undefined) throw new Error(`NVIDIA does not publish the key ${kid}`);
  const publicKey = concatBytes(Uint8Array.of(4), fromBase64Url(key.x), fromBase64Url(key.y));
  const signatureValid = p384.verify(
    fromBase64Url(signature),
    utf8ToBytes(`${header}.${body}`),
    publicKey,
    { lowS: false },
  );
  const nonceMatches = claims.eat_nonce.toLowerCase() === nonce.toLowerCase();
  const current = claims.exp * 1000 > nowMs && claims.iss === nvidiaNras;
  return {
    passed: signatureValid && nonceMatches && current && claims["x-nvidia-overall-att-result"],
    signatureValid,
    nonceMatches,
    current,
    keyId: kid,
  };
}
