import { sumYocto } from "@backstop/shared";
import { pools, type Ledger, type TransferStatus } from "./ledger.js";

export type Statement = {
  readonly totalIn: bigint;
  readonly held: bigint;
  readonly byStatus: Readonly<Record<TransferStatus, bigint>>;
  readonly confirmedByRecipient: Readonly<Record<string, bigint>>;
};

const total = (ledger: Ledger, status: TransferStatus) =>
  sumYocto(ledger.transfers.filter((item) => item.status === status).map((item) => item.amount));

export function statement(ledger: Ledger): Statement {
  const confirmedByRecipient: Record<string, bigint> = {};
  for (const transfer of ledger.transfers) {
    if (transfer.status !== "CONFIRMED") continue;
    confirmedByRecipient[transfer.recipient] =
      (confirmedByRecipient[transfer.recipient] ?? 0n) + transfer.amount;
  }
  return {
    totalIn: sumYocto(pools.map((pool) => ledger.inflow[pool])),
    held: sumYocto(pools.map((pool) => ledger.available[pool])),
    byStatus: {
      PENDING: total(ledger, "PENDING"),
      FAILED: total(ledger, "FAILED"),
      CONFIRMED: total(ledger, "CONFIRMED"),
    },
    confirmedByRecipient,
  };
}

export function ledgerViolations(ledger: Ledger): string[] {
  const view = statement(ledger);
  const accounted =
    view.held + view.byStatus.PENDING + view.byStatus.FAILED + view.byStatus.CONFIRMED;
  const ids = ledger.transfers.map((transfer) => transfer.id);
  return [
    ...(accounted === view.totalIn ? [] : ["Inflows do not equal pools plus transfers"]),
    ...(pools.every((pool) => ledger.available[pool] >= 0n) ? [] : ["A pool is negative"]),
    ...(ledger.bondConsumed <= ledger.maxBondLiability ? [] : ["Bond consumed exceeds liability"]),
    ...(ledger.maxBondLiability <= ledger.inflow.bond ? [] : ["Liability exceeds the bond"]),
    ...(new Set(ids).size === ids.length ? [] : ["A transfer id repeats"]),
    ...(ledger.transfers.every((transfer) => transfer.amount > 0n) ? [] : ["A transfer is empty"]),
  ];
}
