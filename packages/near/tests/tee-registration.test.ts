import { JsonRpcProvider } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesTeeRegistration } from "../src/tee-registration.js";
import { verifyTeeSigner } from "../src/verify.js";

const vault = "vault.testnet";
const hash = "a".repeat(64);
const recorded = {
  txHash: "registration-transaction",
  signingAddress: `0x${"b".repeat(40)}`,
  model: "registered-model",
  attestationHash: `sha256:${hash}`,
};
const args = { address: recorded.signingAddress, model: recorded.model, attestation_hash: hash };

function transaction() {
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    transaction: {
      hash: recorded.txHash,
      signer_id: vault,
      receiver_id: vault,
      actions: [
        {
          FunctionCall: {
            method_name: "register_tee_signer",
            args: Buffer.from(JSON.stringify(args)).toString("base64"),
          },
        },
      ],
    },
    transaction_outcome: { outcome: { logs: [] } },
    receipts_outcome: [
      {
        id: "registration-receipt",
        outcome: {
          executor_id: vault,
          status: { SuccessValue: "" },
          logs: [
            `EVENT_JSON:${JSON.stringify({ standard: "backstop", version: "1.0.0", event: "tee_signer_registered", data: [args] })}`,
          ],
        },
      },
    ],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("historical TEE registration proof", () => {
  it("binds the recorded hash, address and model to a finalized vault registration", () => {
    expect(matchesTeeRegistration(transaction(), vault, recorded)).toBe(true);
  });

  it.each([
    { attestationHash: `sha256:${"c".repeat(64)}` },
    { signingAddress: `0x${"d".repeat(40)}` },
    { model: "substituted-model" },
    { txHash: "substituted-transaction" },
  ])("rejects a tampered record %j", (tampered) => {
    expect(matchesTeeRegistration(transaction(), vault, { ...recorded, ...tampered })).toBe(false);
  });

  it("rejects another receiver or method despite matching event data", () => {
    const raw = transaction();
    raw.transaction.receiver_id = "other.testnet";
    expect(matchesTeeRegistration(raw, vault, recorded)).toBe(false);
    raw.transaction.receiver_id = vault;
    raw.transaction.actions = [
      {
        FunctionCall: {
          method_name: "unrelated",
          args: Buffer.from(JSON.stringify(args)).toString("base64"),
        },
      },
    ];
    expect(matchesTeeRegistration(raw, vault, recorded)).toBe(false);
  });

  it("rejects substituted function arguments despite matching event data", () => {
    const raw = transaction();
    raw.transaction.actions = [
      {
        FunctionCall: {
          method_name: "register_tee_signer",
          args: Buffer.from(JSON.stringify({ ...args, attestation_hash: "c".repeat(64) })).toString(
            "base64",
          ),
        },
      },
    ];
    expect(matchesTeeRegistration(raw, vault, recorded)).toBe(false);
  });

  it("requires a successful registration event emitted by the vault", () => {
    const raw = transaction();
    raw.receipts_outcome = [];
    expect(matchesTeeRegistration(raw, vault, recorded)).toBe(false);
    const foreign = transaction();
    for (const receipt of foreign.receipts_outcome) receipt.outcome.executor_id = "other.testnet";
    expect(matchesTeeRegistration(foreign, vault, recorded)).toBe(false);
    const failed = transaction();
    expect(
      matchesTeeRegistration(
        { ...failed, status: { Failure: { error: "ERR_OWNER" } } },
        vault,
        recorded,
      ),
    ).toBe(false);
    const failedReceipt = transaction();
    expect(
      matchesTeeRegistration(
        {
          ...failedReceipt,
          receipts_outcome: failedReceipt.receipts_outcome.map((receipt) => ({
            ...receipt,
            outcome: { ...receipt.outcome, status: { Failure: { error: "ERR_OWNER" } } },
          })),
        },
        vault,
        recorded,
      ),
    ).toBe(false);
  });

  it("refuses nonfinal proof", () => {
    expect(() =>
      matchesTeeRegistration(
        { ...transaction(), final_execution_status: "EXECUTED" },
        vault,
        recorded,
      ),
    ).toThrow();
  });

  it.each(["refreshed", "revoked", "changed-model"])(
    "checks current authorization separately: %s",
    async (state) => {
      const current =
        state === "revoked"
          ? null
          : {
              model: state === "changed-model" ? "other-model" : recorded.model,
              attestation_hash: "c".repeat(64),
              registered_at_ns: "200",
            };
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: "1", result: transaction() }))
        .mockResolvedValueOnce(
          Response.json({
            jsonrpc: "2.0",
            id: "2",
            result: { result: [...Buffer.from(JSON.stringify(current))], logs: [] },
          }),
        );
      vi.stubGlobal("fetch", fetch);
      const finding = await verifyTeeSigner(
        new JsonRpcProvider({ url: "https://rpc.test" }),
        vault,
        recorded,
        true,
      );
      expect(finding.ok).toBe(state === "refreshed");
      expect(finding.detail).toContain("finalized registration");
      expect(finding.detail).toContain("current model authorization");
    },
  );

  it("keeps older registrations historical without requiring mutable current state", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: "1", result: transaction() }));
    vi.stubGlobal("fetch", fetch);
    const finding = await verifyTeeSigner(
      new JsonRpcProvider({ url: "https://rpc.test" }),
      vault,
      recorded,
      false,
    );
    expect(finding.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
