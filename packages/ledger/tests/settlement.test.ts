import { describe, expect, it } from "vitest";
import { near } from "@backstop/shared";
import {
  beginSettlement,
  failureLegs,
  isSettled,
  ledgerViolations,
  postGuarantee,
  recoveryCapacity,
  resolveTransfer,
  statement,
  successLegs,
  type Ledger,
} from "../src/index.js";
import { confirmAll, customer, demoLedger, guarantor, unwrap } from "./support.js";

const confirm = (ledger: Ledger, id: string) => unwrap(resolveTransfer(ledger, id, true));

describe("success settlement", () => {
  it("reconciles the canonical recovery ledger: 0.69 in, 0.52 paid, 0.13 released, 0.04 refunded", () => {
    const ledger = demoLedger();
    const legs = unwrap(
      successLegs(ledger, {
        payees: [
          { account: "gamma.fixture.testnet", amount: near("0.40") },
          { account: "delta.fixture.testnet", amount: near("0.12") },
        ],
        primarySucceeded: false,
      }),
    );
    const settled = confirmAll(
      unwrap(beginSettlement(ledger, "settle-1", "success", legs)),
      confirm,
    );
    const view = statement(settled);
    expect(isSettled(settled)).toBe(true);
    expect(view.totalIn).toBe(near("0.69"));
    expect(view.byStatus.CONFIRMED).toBe(near("0.69"));
    expect(view.confirmedByRecipient).toEqual({
      "gamma.fixture.testnet": near("0.40"),
      "delta.fixture.testnet": near("0.12"),
      [customer]: near("0.04"),
      [guarantor]: near("0.13"),
    });
    expect(settled.bondConsumed).toBe(near("0.12"));
    expect(ledgerViolations(settled)).toEqual([]);
  });

  it("TC-002 pays a successful primary from escrow, earns the guarantor the premium, releases the bond", () => {
    const ledger = demoLedger();
    const legs = unwrap(
      successLegs(ledger, {
        payees: [{ account: "alpha.fixture.testnet", amount: near("0.30") }],
        primarySucceeded: true,
      }),
    );
    const settled = confirmAll(
      unwrap(beginSettlement(ledger, "settle-1", "success", legs)),
      confirm,
    );
    expect(statement(settled).confirmedByRecipient).toEqual({
      "alpha.fixture.testnet": near("0.30"),
      [customer]: near("0.10"),
      [guarantor]: near("0.29"),
    });
    expect(settled.bondConsumed).toBe(0n);
  });

  it("TC-013 refuses a payout beyond escrow plus liability and leaves the ledger unchanged", () => {
    const ledger = demoLedger();
    expect(recoveryCapacity(ledger)).toBe(near("0.65"));
    const outcome = successLegs(ledger, {
      payees: [{ account: "gamma.fixture.testnet", amount: near("0.66") }],
      primarySucceeded: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure.code).toBe("LIABILITY_EXCEEDED");
    expect(ledger).toEqual(demoLedger());
  });

  it("TC-008 a second settlement on the same task is refused and moves nothing", () => {
    const ledger = demoLedger();
    const legs = failureLegs(ledger, near("0.10"));
    const first = unwrap(beginSettlement(ledger, "settle-1", "failure", legs));
    const second = beginSettlement(first, "settle-2", "failure", legs);
    expect(second.ok ? null : second.failure.code).toBe("ALREADY_SETTLED");
    expect(statement(first).byStatus.PENDING).toBe(near("0.69"));
  });
});

describe("failure settlement", () => {
  it("TC-010 refunds escrow and premium and compensates within the liability cap", () => {
    const ledger = demoLedger();
    const legs = failureLegs(ledger, near("0.10"));
    const settled = confirmAll(unwrap(beginSettlement(ledger, "fail-1", "failure", legs)), confirm);
    expect(statement(settled).confirmedByRecipient).toEqual({
      [customer]: near("0.54"),
      [guarantor]: near("0.15"),
    });
    expect(settled.bondConsumed).toBe(near("0.10"));
    expect(ledgerViolations(settled)).toEqual([]);
  });

  it("never compensates more than the liability that remains", () => {
    const ledger = demoLedger();
    const legs = failureLegs(ledger, near("5"));
    const compensation = legs.find((item) => item.purpose === "compensation");
    expect(compensation?.amount).toBe(near("0.25"));
  });
});

describe("guarantees", () => {
  it("refuse coverage above the bond, a self-guarantee and a second guarantor", () => {
    const ledger = demoLedger();
    const fresh = { ...ledger, guarantor: null, maxBondLiability: 0n };
    expect(postGuarantee(fresh, guarantor, near("0.1"), near("0.2")).ok).toBe(false);
    expect(postGuarantee(fresh, customer, near("0.1"), near("0.1")).ok).toBe(false);
    expect(postGuarantee(ledger, "other.fixture.testnet", near("0.1"), near("0.1")).ok).toBe(false);
  });
});
