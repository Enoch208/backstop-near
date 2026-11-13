import { fail, minYocto, succeed, sumYocto, type Outcome } from "@backstop/shared";
import {
  bondSpendable,
  liabilityRemaining,
  type Ledger,
  type Pool,
  type TransferPurpose,
} from "./ledger.js";

export type Leg = {
  readonly recipient: string;
  readonly amount: bigint;
  readonly pool: Pool;
  readonly purpose: TransferPurpose;
};

export type Payee = { readonly account: string; readonly amount: bigint };

export type SuccessTerms = {
  readonly payees: readonly Payee[];
  readonly primarySucceeded: boolean;
};

const leg = (recipient: string, amount: bigint, pool: Pool, purpose: TransferPurpose): Leg[] =>
  amount > 0n ? [{ recipient, amount, pool, purpose }] : [];

function payeeLegs(payees: readonly Payee[], fromEscrow: bigint): Leg[] {
  return payees.reduce<{ legs: Leg[]; escrowLeft: bigint }>(
    (split, payee) => {
      const escrowPart = minYocto(payee.amount, split.escrowLeft);
      return {
        escrowLeft: split.escrowLeft - escrowPart,
        legs: [
          ...split.legs,
          ...leg(payee.account, escrowPart, "escrow", "payout"),
          ...leg(payee.account, payee.amount - escrowPart, "bond", "payout"),
        ],
      };
    },
    { legs: [], escrowLeft: fromEscrow },
  ).legs;
}

function premiumLeg(ledger: Ledger, earnedByGuarantor: boolean): Leg[] {
  const premium = ledger.available.premium;
  if (earnedByGuarantor && ledger.guarantor !== null) {
    return leg(ledger.guarantor, premium, "premium", "premium_earned");
  }
  return leg(ledger.customer, premium, "premium", "premium_refund");
}

function releaseLeg(ledger: Ledger, bondSpent: bigint): Leg[] {
  if (ledger.guarantor === null) return [];
  return leg(ledger.guarantor, ledger.available.bond - bondSpent, "bond", "bond_release");
}

export function successLegs(ledger: Ledger, terms: SuccessTerms): Outcome<Leg[]> {
  if (terms.payees.length === 0)
    return fail("POLICY_VIOLATION", "A success settlement pays someone");
  if (terms.payees.some((payee) => payee.amount <= 0n)) {
    return fail("POLICY_VIOLATION", "Every payee receives a positive amount");
  }
  const total = sumYocto(terms.payees.map((payee) => payee.amount));
  const fromEscrow = minYocto(total, ledger.available.escrow);
  const fromBond = total - fromEscrow;
  if (fromBond > bondSpendable(ledger)) {
    return fail(
      "LIABILITY_EXCEEDED",
      "The payout exceeds escrow plus the remaining bond liability",
    );
  }
  return succeed([
    ...payeeLegs(terms.payees, fromEscrow),
    ...premiumLeg(ledger, terms.primarySucceeded),
    ...leg(ledger.customer, ledger.available.escrow - fromEscrow, "escrow", "escrow_refund"),
    ...releaseLeg(ledger, fromBond),
  ]);
}

export function failureLegs(ledger: Ledger, compensationCap: bigint): Leg[] {
  const compensation =
    ledger.guarantor === null
      ? 0n
      : minYocto(liabilityRemaining(ledger), compensationCap, ledger.available.bond);
  return [
    ...leg(ledger.customer, ledger.available.escrow, "escrow", "escrow_refund"),
    ...leg(ledger.customer, compensation, "bond", "compensation"),
    ...premiumLeg(ledger, false),
    ...releaseLeg(ledger, compensation),
  ];
}
