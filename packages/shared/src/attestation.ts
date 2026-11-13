import {
  evidenceHash,
  type EvidenceBundle,
  type SignedChallengeRuling,
} from "./evidence.schema.js";
import { verifyValue } from "./signing.js";

export function isAuthenticEvidence(bundle: EvidenceBundle, verifierPublicKey: string): boolean {
  return (
    evidenceHash(bundle.body) === bundle.evidenceHash &&
    bundle.signature.publicKey === verifierPublicKey &&
    verifyValue({ evidenceHash: bundle.evidenceHash }, bundle.signature)
  );
}

export function isAuthenticRuling(
  signed: SignedChallengeRuling,
  verifierPublicKey: string,
): boolean {
  return (
    signed.signature.publicKey === verifierPublicKey && verifyValue(signed.ruling, signed.signature)
  );
}
