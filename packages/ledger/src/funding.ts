import { fail, succeed, type Outcome } from "@backstop/shared";
import type { Ledger, Pool } from "./ledger.js";

function credit(ledger: Ledger, pool: Pool, amount: bigint): Ledger {
  return {
    ...ledger,
    inflow: { ...ledger.inflow, [pool]: ledger.inflow[pool] + amount },
    available: { ...ledger.available, [pool]: ledger.available[pool] + amount },
  };
}

function refuseLateOrEmpty(ledger: Ledger, amount: bigint): Outcome<Ledger> | null {
  if (ledger.settlementKey !== null) return fail("ALREADY_SETTLED", "The task is already settling");
  if (amount <= 0n) return fail("POLICY_VIOLATION", "A deposit must be positive");
  return null;
}

export function depositEscrow(ledger: Ledger, amount: bigint): Outcome<Ledger> {
  return refuseLateOrEmpty(ledger, amount) ?? succeed(credit(ledger, "escrow", amount));
}

export function depositPremium(ledger: Ledger, amount: bigint): Outcome<Ledger> {
  return refuseLateOrEmpty(ledger, amount) ?? succeed(credit(ledger, "premium", amount));
}

export function postGuarantee(
  ledger: Ledger,
  guarantor: string,
  bond: bigint,
  maxLiability: bigint,
): Outcome<Ledger> {
  const refused = refuseLateOrEmpty(ledger, bond);
  if (refused !== null) return refused;
  if (guarantor === ledger.customer) {
    return fail("POLICY_VIOLATION", "The customer cannot guarantee their own task");
  }
  if (ledger.guarantor !== null) return fail("DUPLICATE", "The task already has a guarantor");
  if (maxLiability < 0n || maxLiability > bond) {
    return fail("LIABILITY_EXCEEDED", "Coverage can never exceed the bond that backs it");
  }
  return succeed({ ...credit(ledger, "bond", bond), guarantor, maxBondLiability: maxLiability });
}
