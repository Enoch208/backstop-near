import { describe, expect, it } from "vitest";
import { near } from "@backstop/shared";
import {
  beginSettlement,
  failureLegs,
  isSettled,
  maxTransferRetries,
  resolveTransfer,
  retryTransfer,
  statement,
} from "../src/index.js";
import { demoLedger, unwrap } from "./support.js";

function pendingSettlement() {
  const ledger = demoLedger();
  return unwrap(beginSettlement(ledger, "fail-1", "failure", failureLegs(ledger, near("0.10"))));
}

describe("transfer callbacks", () => {
  it("TC-009 a failed transfer retries to confirmed exactly once", () => {
    const settling = pendingSettlement();
    const [first] = settling.transfers;
    if (first === undefined) throw new Error("expected a transfer");
    const failed = unwrap(resolveTransfer(settling, first.id, false));
    expect(failed.transfers[0]?.status).toBe("FAILED");
    const retried = unwrap(retryTransfer(failed, first.id));
    const confirmed = unwrap(resolveTransfer(retried, first.id, true));
    const replayed = unwrap(resolveTransfer(confirmed, first.id, true));
    const lateFailure = unwrap(resolveTransfer(replayed, first.id, false));
    expect(lateFailure.transfers[0]).toMatchObject({ status: "CONFIRMED", retries: 1 });
    expect(statement(lateFailure).byStatus.CONFIRMED).toBe(first.amount);
  });

  it("refuses to retry a confirmed or pending transfer, and stops after the retry cap", () => {
    const settling = pendingSettlement();
    const [first] = settling.transfers;
    if (first === undefined) throw new Error("expected a transfer");
    expect(retryTransfer(settling, first.id).ok).toBe(false);
    const exhausted = Array.from({ length: maxTransferRetries }).reduce<typeof settling>(
      (ledger) => unwrap(retryTransfer(unwrap(resolveTransfer(ledger, first.id, false)), first.id)),
      settling,
    );
    const failedAgain = unwrap(resolveTransfer(exhausted, first.id, false));
    const refused = retryTransfer(failedAgain, first.id);
    expect(refused.ok ? null : refused.failure.code).toBe("TRANSFER_NOT_RETRYABLE");
    expect(isSettled(failedAgain)).toBe(false);
  });
});
