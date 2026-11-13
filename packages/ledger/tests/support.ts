import { near, type Outcome } from "@backstop/shared";
import {
  depositEscrow,
  depositPremium,
  openLedger,
  postGuarantee,
  type Ledger,
} from "../src/index.js";

export const customer = "customer.fixture.testnet";
export const guarantor = "guarantor.fixture.testnet";

export function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.failure.code}: ${outcome.failure.message}`);
  return outcome.value;
}

export function demoLedger(): Ledger {
  const escrowed = unwrap(depositEscrow(openLedger(customer), near("0.40")));
  const premiumed = unwrap(depositPremium(escrowed, near("0.04")));
  return unwrap(postGuarantee(premiumed, guarantor, near("0.25"), near("0.25")));
}

export function confirmAll(
  ledger: Ledger,
  resolve: (ledger: Ledger, id: string) => Ledger,
): Ledger {
  return ledger.transfers.reduce((current, transfer) => resolve(current, transfer.id), ledger);
}
