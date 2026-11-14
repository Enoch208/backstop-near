import { liveAttestation, type Attestation } from "@backstop/tee";
import type { Runtime } from "./runtime.js";

export async function trustAttestedModel(
  runtime: Runtime,
  model: string,
  log: (line: string) => void,
): Promise<Attestation> {
  const attestation = await liveAttestation(model);
  for (const finding of attestation.findings.filter((item) => !item.ok))
    log(`TEE check failed: ${finding.subject}: ${finding.detail}`);
  for (const signer of attestation.signers) runtime.teeSigners.set(signer, model);
  log(
    attestation.signers.length === 0
      ? `No attested enclave key for ${model}; its patches will carry no verified receipt`
      : `Attested ${model} enclave key ${attestation.signers.join(", ")} (Intel TDX + NVIDIA, fresh nonce)`,
  );
  return attestation;
}
