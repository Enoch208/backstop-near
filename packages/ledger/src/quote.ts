import { fromYocto, type TaskManifest } from "@backstop/shared";

export type Quote = {
  readonly escrow: bigint;
  readonly premium: bigint;
  readonly coverageLimit: bigint;
  readonly compensationCap: bigint;
  readonly customerMaxCharge: bigint;
  readonly recoveryBudget: bigint;
  readonly protocolFee: bigint;
};

export function quote(manifest: TaskManifest): Quote {
  const escrow = fromYocto(manifest.budget.escrowYocto);
  const premium = fromYocto(manifest.budget.premiumYocto);
  const coverageLimit =
    manifest.guarantee === null ? 0n : fromYocto(manifest.guarantee.maxLiabilityYocto);
  const compensationCap =
    manifest.guarantee === null ? 0n : fromYocto(manifest.guarantee.compensationCapYocto);
  return {
    escrow,
    premium,
    coverageLimit,
    compensationCap,
    customerMaxCharge: escrow + premium,
    recoveryBudget: escrow + coverageLimit,
    protocolFee: 0n,
  };
}
