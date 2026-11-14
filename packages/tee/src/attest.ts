import { digestOf, sha256Hex, type Digest } from "@backstop/shared";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { addressOfPublicKey, addressSchema } from "./eth.js";
import { verifyGpu, type Fetch, type GpuVerdict } from "./gpu.js";
import {
  acceptableTcb,
  bindsSigner,
  intelCollateral,
  verifyQuote,
  type CollateralSource,
} from "./quote.js";

export const nearAiAttestationBase = "https://cloud-api.near.ai/v1";

const instanceSchema = z.object({
  model_name: z.string(),
  signing_address: addressSchema,
  signing_algo: z.literal("ecdsa"),
  signing_public_key: z.string().regex(/^[0-9a-fA-F]{128}$/),
  request_nonce: z.string().regex(/^[0-9a-fA-F]{64}$/),
  intel_quote: z.string().regex(/^[0-9a-fA-F]+$/),
  nvidia_payload: z.string(),
});
const reportSchema = z.object({ model_attestations: z.array(instanceSchema).min(1) });
type Instance = z.infer<typeof instanceSchema>;

export type Finding = { readonly ok: boolean; readonly subject: string; readonly detail: string };

export type AttestedInstance = {
  readonly signingAddress: string;
  readonly quoteHash: Digest;
  readonly tcbStatus: string;
  readonly mrTd: string;
  readonly gpu: GpuVerdict;
};

export type Attestation = {
  readonly model: string;
  readonly nonce: string;
  readonly attestedAtMs: number;
  readonly signers: readonly string[];
  readonly instances: readonly AttestedInstance[];
  readonly findings: readonly Finding[];
  readonly attestationHash: Digest;
};

export type AttestOptions = {
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly collateral: CollateralSource;
  readonly nowMs: number;
  readonly nonce: string;
};

async function checkInstance(
  instance: Instance,
  options: AttestOptions,
  findings: Finding[],
): Promise<AttestedInstance | null> {
  const address = instance.signing_address;
  const note = (ok: boolean, subject: string, detail: string) => {
    findings.push({ ok, subject: `${address} ${subject}`, detail });
    return ok;
  };
  const fresh = note(
    instance.request_nonce.toLowerCase() === options.nonce,
    "nonce",
    "the report answers our fresh nonce",
  );
  const keyMatches = note(
    addressOfPublicKey(hexToBytes(instance.signing_public_key)) === address,
    "key",
    "the signing public key hashes to the signing address",
  );
  const quote = await verifyQuote(instance.intel_quote, options.collateral, options.nowMs);
  const genuine = note(
    acceptableTcb.has(quote.status),
    "tdx",
    `Intel DCAP verifies the TDX quote, TCB ${quote.status}`,
  );
  const bound = note(
    bindsSigner(quote.reportData, address, options.nonce),
    "binding",
    "the quote's report data commits to the signing address and our nonce",
  );
  const gpu = await verifyGpu(instance.nvidia_payload, options.nonce, options.fetch, options.nowMs);
  const gpuOk = note(
    gpu.passed,
    "gpu",
    `NVIDIA NRAS attests the GPUs (token ${gpu.signatureValid ? "signature valid" : "signature INVALID"}, nonce ${gpu.nonceMatches ? "matches" : "differs"})`,
  );
  if (!(fresh && keyMatches && genuine && bound && gpuOk)) return null;
  return {
    signingAddress: address,
    quoteHash: `sha256:${sha256Hex(instance.intel_quote.toLowerCase())}`,
    tcbStatus: quote.status,
    mrTd: quote.mrTd,
    gpu,
  };
}

export async function attestModel(model: string, options: AttestOptions): Promise<Attestation> {
  const url = `${options.baseUrl}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${options.nonce}`;
  const response = await options.fetch(url);
  if (!response.ok)
    throw new Error(
      `NEAR AI Cloud refused the attestation report: HTTP ${String(response.status)}`,
    );
  const report = reportSchema.parse(await response.json());
  const findings: Finding[] = [];
  const instances: AttestedInstance[] = [];
  for (const instance of report.model_attestations) {
    if (instance.model_name !== model) continue;
    const attested = await checkInstance(instance, options, findings);
    if (attested !== null) instances.push(attested);
  }
  const signers = [...new Set(instances.map((instance) => instance.signingAddress))];
  const summary = {
    model,
    nonce: options.nonce,
    instances: instances.map((instance) => ({ ...instance, gpu: { ...instance.gpu } })),
  };
  return {
    model,
    nonce: options.nonce,
    attestedAtMs: options.nowMs,
    signers,
    instances,
    findings,
    attestationHash: digestOf(summary),
  };
}

export function liveAttestation(
  model: string,
  baseUrl = nearAiAttestationBase,
): Promise<Attestation> {
  return attestModel(model, {
    baseUrl,
    fetch: (url, init) => fetch(url, init),
    collateral: intelCollateral,
    nowMs: Date.now(),
    nonce: bytesToHex(randomBytes(32)),
  });
}

export function signerRecord(attestation: Attestation, signer: string) {
  const instances = attestation.instances.filter((item) => item.signingAddress === signer);
  const first = instances[0];
  return {
    model: attestation.model,
    signingAddress: signer,
    attestationHash: attestation.attestationHash,
    nonce: attestation.nonce,
    instances: instances.length,
    tcbStatus: first?.tcbStatus ?? null,
    mrTd: first?.mrTd ?? null,
    nvidiaKeyId: first?.gpu.keyId ?? null,
  };
}
