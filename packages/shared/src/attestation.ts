import { evidenceHash, type EvidenceBundle } from "./evidence.schema.js";
import { verifyValue } from "./signing.js";

export function isAuthenticEvidence(bundle: EvidenceBundle, verifierPublicKey: string): boolean {
  return (
    evidenceHash(bundle.body) === bundle.evidenceHash &&
    bundle.signature.publicKey === verifierPublicKey &&
    verifyValue({ evidenceHash: bundle.evidenceHash }, bundle.signature)
  );
}
