export const pools = ["escrow", "premium", "bond"] as const;
export type Pool = (typeof pools)[number];

export const transferPurposes = [
  "payout",
  "escrow_refund",
  "premium_refund",
  "premium_earned",
  "bond_release",
  "compensation",
] as const;
export type TransferPurpose = (typeof transferPurposes)[number];

export type TransferStatus = "PENDING" | "CONFIRMED" | "FAILED";

export type Transfer = {
  readonly id: string;
  readonly recipient: string;
  readonly amount: bigint;
  readonly pool: Pool;
  readonly purpose: TransferPurpose;
  readonly status: TransferStatus;
  readonly retries: number;
};

export type PoolAmounts = Readonly<Record<Pool, bigint>>;

export type Ledger = {
  readonly customer: string;
  readonly guarantor: string | null;
  readonly inflow: PoolAmounts;
  readonly available: PoolAmounts;
  readonly maxBondLiability: bigint;
  readonly bondConsumed: bigint;
  readonly settlementKey: string | null;
  readonly settlementKind: "success" | "failure" | null;
  readonly transfers: readonly Transfer[];
};

export const maxTransferRetries = 3;

const zeroPools: PoolAmounts = { escrow: 0n, premium: 0n, bond: 0n };

export function openLedger(customer: string): Ledger {
  return {
    customer,
    guarantor: null,
    inflow: zeroPools,
    available: zeroPools,
    maxBondLiability: 0n,
    bondConsumed: 0n,
    settlementKey: null,
    settlementKind: null,
    transfers: [],
  };
}

export function liabilityRemaining(ledger: Ledger): bigint {
  return ledger.maxBondLiability - ledger.bondConsumed;
}

export function bondSpendable(ledger: Ledger): bigint {
  const remaining = liabilityRemaining(ledger);
  return remaining < ledger.available.bond ? remaining : ledger.available.bond;
}

export function recoveryCapacity(ledger: Ledger): bigint {
  return ledger.available.escrow + bondSpendable(ledger);
}
