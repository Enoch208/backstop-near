import { describe, expect, it } from "vitest";
import { digestText } from "@backstop/shared";
import { fromHex32, parseEventLog, readOutcome, toHex32 } from "../src/index.js";

const response = (status: unknown, logs: string[]) => ({
  status,
  transaction: { hash: "tx-hash", signer_id: "coordinator.testnet" },
  transaction_outcome: { outcome: { logs: [] } },
  receipts_outcome: [
    { id: "receipt", outcome: { logs, executor_id: "vault.testnet", status: {} } },
  ],
});

describe("the vault wire format", () => {
  it("converts digests to the contract's bare hex and back", () => {
    const digest = digestText("checkout-001:3");
    expect(toHex32(digest)).toMatch(/^[0-9a-f]{64}$/);
    expect(fromHex32(toHex32(digest))).toBe(digest);
    expect(() => toHex32("sha256:xyz")).toThrow();
  });

  it("reads NEP-297 backstop events and ignores every other log line", () => {
    const line =
      'EVENT_JSON:{"standard":"backstop","version":"1.0.0","event":"task_settled","data":[{"task_id":"t","state_version":9}]}';
    expect(parseEventLog(line)).toEqual({
      event: "task_settled",
      data: { task_id: "t", state_version: 9 },
    });
    expect(parseEventLog("plain log")).toBeNull();
    expect(
      parseEventLog(
        'EVENT_JSON:{"standard":"nep171","version":"1.0.0","event":"nft_mint","data":[{}]}',
      ),
    ).toBeNull();
  });

  it("turns a failed transaction into its contract error code", () => {
    const failed = readOutcome(
      response(
        {
          Failure: {
            ActionError: {
              kind: {
                FunctionCallError: {
                  ExecutionError: "Smart contract panicked: ERR_ALREADY_SETTLED",
                },
              },
            },
          },
        },
        [],
      ),
    );
    expect(failed).toMatchObject({
      ok: false,
      errorCode: "ERR_ALREADY_SETTLED",
      txHash: "tx-hash",
    });
    const settled = readOutcome(
      response({ SuccessValue: "" }, [
        'EVENT_JSON:{"standard":"backstop","version":"1.0.0","event":"transfer_confirmed","data":[{"task_id":"t"}]}',
      ]),
    );
    expect(settled).toMatchObject({
      ok: true,
      errorCode: null,
      events: [{ event: "transfer_confirmed" }],
    });
  });

  it("distinguishes a failed vault callback from a successful token resolver", () => {
    const status = { SuccessValue: "MA==" };
    const log =
      'EVENT_JSON:{"standard":"backstop","version":"1.0.0","event":"task_funded","data":[{"task_id":"t"}]}';
    const result = readOutcome({
      ...response(status, []),
      receipts_outcome: [
        {
          id: "rollback",
          outcome: { logs: [log], executor_id: "vault.testnet", status: { Failure: {} } },
        },
        {
          id: "resolver",
          outcome: { logs: [log], executor_id: "token.testnet", status },
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.vaultEvents?.["vault.testnet"]).toBeUndefined();
    expect(result.vaultEvents?.["token.testnet"]).toHaveLength(1);
  });
});
