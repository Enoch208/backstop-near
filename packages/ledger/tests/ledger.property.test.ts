import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { yoctoPerNear } from "@backstop/shared";
import {
  beginSettlement,
  depositEscrow,
  depositPremium,
  failureLegs,
  ledgerViolations,
  openLedger,
  postGuarantee,
  resolveTransfer,
  retryTransfer,
  statement,
  successLegs,
  type Ledger,
} from "../src/index.js";
import { customer, guarantor } from "./support.js";

const amount = fc.bigInt({ min: 1n, max: 3n * yoctoPerNear });

const callback = fc.oneof(
  fc.record({ kind: fc.constant("resolve" as const), index: fc.nat(8), succeeded: fc.boolean() }),
  fc.record({ kind: fc.constant("retry" as const), index: fc.nat(8) }),
  fc.record({ kind: fc.constant("settleAgain" as const) }),
);

const scenario = fc.record({
  escrow: amount,
  premium: fc.option(amount, { nil: null }),
  bond: fc.option(fc.tuple(amount, fc.nat(100)), { nil: null }),
  success: fc.boolean(),
  payees: fc.array(amount, { minLength: 1, maxLength: 3 }),
  primarySucceeded: fc.boolean(),
  compensationCap: amount,
  callbacks: fc.array(callback, { maxLength: 40 }),
});

function keep(ledger: Ledger, outcome: { ok: true; value: Ledger } | { ok: false }): Ledger {
  return outcome.ok ? outcome.value : ledger;
}

describe("ledger invariants", () => {
  it("NFR-001 conserve funds and never double-pay across random settlements and callback storms", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        let ledger = keep(openLedger(customer), depositEscrow(openLedger(customer), input.escrow));
        if (input.premium !== null) ledger = keep(ledger, depositPremium(ledger, input.premium));
        if (input.bond !== null) {
          const [bond, percent] = input.bond;
          ledger = keep(
            ledger,
            postGuarantee(ledger, guarantor, bond, (bond * BigInt(percent)) / 100n),
          );
        }
        const legs = input.success
          ? successLegs(ledger, {
              payees: input.payees.map((paid, index) => ({
                account: `payee-${String(index)}.testnet`,
                amount: paid,
              })),
              primarySucceeded: input.primarySucceeded,
            })
          : { ok: true as const, value: failureLegs(ledger, input.compensationCap) };
        if (!legs.ok) return;
        ledger = keep(
          ledger,
          beginSettlement(ledger, "key", input.success ? "success" : "failure", legs.value),
        );
        const totalIn = statement(ledger).totalIn;
        for (const event of input.callbacks) {
          const transfer =
            ledger.transfers[
              event.kind === "settleAgain" ? 0 : event.index % Math.max(1, ledger.transfers.length)
            ];
          if (event.kind === "settleAgain") {
            expect(beginSettlement(ledger, "key-2", "success", legs.value).ok).toBe(false);
          } else if (transfer !== undefined) {
            ledger =
              event.kind === "resolve"
                ? keep(ledger, resolveTransfer(ledger, transfer.id, event.succeeded))
                : keep(ledger, retryTransfer(ledger, transfer.id));
          }
          expect(ledgerViolations(ledger)).toEqual([]);
          expect(statement(ledger).byStatus.CONFIRMED <= totalIn).toBe(true);
        }
      }),
      { numRuns: 300, seed: 20_261_114 },
    );
  });
});
