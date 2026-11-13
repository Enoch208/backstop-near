import { fail, succeed, sumYocto, type Outcome } from "@backstop/shared";
import {
  maxTransferRetries,
  pools,
  type Ledger,
  type PoolAmounts,
  type Transfer,
} from "./ledger.js";
import type { Leg } from "./plan.js";

export type SettlementKind = "success" | "failure";

function debited(available: PoolAmounts, legs: readonly Leg[]): PoolAmounts {
  const spent = (pool: (typeof pools)[number]) =>
    sumYocto(legs.filter((item) => item.pool === pool).map((item) => item.amount));
  return {
    escrow: available.escrow - spent("escrow"),
    premium: available.premium - spent("premium"),
    bond: available.bond - spent("bond"),
  };
}

function bondUsedFor(legs: readonly Leg[]): bigint {
  return sumYocto(
    legs
      .filter((item) => item.pool === "bond" && item.purpose !== "bond_release")
      .map((item) => item.amount),
  );
}

export function beginSettlement(
  ledger: Ledger,
  settlementKey: string,
  kind: SettlementKind,
  legs: readonly Leg[],
): Outcome<Ledger> {
  if (ledger.settlementKey !== null) {
    return fail("ALREADY_SETTLED", `Settlement ${ledger.settlementKey} already holds this task`);
  }
  const available = debited(ledger.available, legs);
  if (pools.some((pool) => available[pool] < 0n)) {
    return fail("INSUFFICIENT_FUNDS", "The plan spends more than a pool holds");
  }
  const bondConsumed = ledger.bondConsumed + bondUsedFor(legs);
  if (bondConsumed > ledger.maxBondLiability) {
    return fail("LIABILITY_EXCEEDED", "The plan consumes more bond than the guarantee covers");
  }
  const transfers: Transfer[] = legs.map((item, index) => ({
    ...item,
    id: `${settlementKey}:${String(index)}`,
    status: "PENDING",
    retries: 0,
  }));
  return succeed({
    ...ledger,
    available,
    bondConsumed,
    settlementKey,
    settlementKind: kind,
    transfers,
  });
}

function withTransfer(ledger: Ledger, next: Transfer): Ledger {
  return {
    ...ledger,
    transfers: ledger.transfers.map((transfer) => (transfer.id === next.id ? next : transfer)),
  };
}

export function resolveTransfer(
  ledger: Ledger,
  transferId: string,
  succeeded: boolean,
): Outcome<Ledger> {
  const transfer = ledger.transfers.find((candidate) => candidate.id === transferId);
  if (transfer === undefined) return fail("NOT_FOUND", `No transfer ${transferId}`);
  if (transfer.status !== "PENDING") return succeed(ledger);
  return succeed(withTransfer(ledger, { ...transfer, status: succeeded ? "CONFIRMED" : "FAILED" }));
}

export function retryTransfer(ledger: Ledger, transferId: string): Outcome<Ledger> {
  const transfer = ledger.transfers.find((candidate) => candidate.id === transferId);
  if (transfer === undefined) return fail("NOT_FOUND", `No transfer ${transferId}`);
  if (transfer.status !== "FAILED") {
    return fail("TRANSFER_NOT_RETRYABLE", `Transfer ${transferId} is ${transfer.status}`);
  }
  if (transfer.retries >= maxTransferRetries) {
    return fail("TRANSFER_NOT_RETRYABLE", `Transfer ${transferId} used all its retries`);
  }
  return succeed(
    withTransfer(ledger, { ...transfer, status: "PENDING", retries: transfer.retries + 1 }),
  );
}

export function isSettled(ledger: Ledger): boolean {
  return (
    ledger.settlementKey !== null &&
    ledger.transfers.every((transfer) => transfer.status === "CONFIRMED")
  );
}
