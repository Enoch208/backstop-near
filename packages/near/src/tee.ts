import type { Account } from "near-api-js";
import { z } from "zod";
import { callVault, type Vault } from "./vault.js";
import { hex32Schema, type Hex32 } from "./wire.js";

export const teeSignerSchema = z.object({
  model: z.string(),
  attestation_hash: hex32Schema,
  registered_at_ns: z.string(),
});
export type TeeSignerView = z.infer<typeof teeSignerSchema>;

export const inferenceViewSchema = z.object({
  task_id: z.string(),
  attempt: z.number(),
  model: z.string(),
  request_hash: hex32Schema,
  response_hash: hex32Schema,
  signer: z.string(),
  artifact_hash: hex32Schema,
});

export const registerTeeSigner = (
  vault: Vault,
  owner: Account,
  address: string,
  model: string,
  attestationHash: Hex32,
) =>
  callVault(vault, owner, "register_tee_signer", {
    address,
    model,
    attestation_hash: attestationHash,
  });

export type AttestedChainVerdict = {
  readonly attempt: number;
  readonly artifactHash: Hex32;
  readonly suiteHash: Hex32;
  readonly evidenceHash: Hex32;
  readonly signedText: string;
  readonly signature: string;
};

export const recordAttestedVerdict = (
  vault: Vault,
  verifier: Account,
  taskId: string,
  verdict: AttestedChainVerdict,
) =>
  callVault(vault, verifier, "record_attested_verdict", {
    task_id: taskId,
    attempt: verdict.attempt,
    artifact_hash: verdict.artifactHash,
    suite_hash: verdict.suiteHash,
    evidence_hash: verdict.evidenceHash,
    inference: { signed_text: verdict.signedText, signature: verdict.signature },
  });

async function view<T>(
  vault: Vault,
  reader: Account,
  method: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const result = await reader.provider.callFunction({ contractId: vault.contractId, method, args });
  return schema.nullable().parse(result ?? null);
}

export const getTeeSigner = (vault: Vault, reader: Account, address: string) =>
  view(vault, reader, "get_tee_signer", { address }, teeSignerSchema);

export const getInference = (vault: Vault, reader: Account, taskId: string, attempt: number) =>
  view(vault, reader, "get_inference", { task_id: taskId, attempt }, inferenceViewSchema);
