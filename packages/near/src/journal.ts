import { createHash } from "node:crypto";
import { SignedTransaction, baseEncode, type Account, type Action } from "near-api-js";
import { z } from "zod";
import { readOutcome } from "./outcome.js";

const finality = z.object({
  final_execution_status: z.literal("FINAL"),
  status: z.union([
    z.object({ SuccessValue: z.string() }),
    z.object({ Failure: z.looseObject({}) }),
  ]),
});

export function readFinalOutcome(raw: unknown) {
  finality.parse(raw);
  return readOutcome(raw);
}

export const preparedCallSchema = z.strictObject({
  transaction: z.base64(),
  txHash: z.string().min(1),
  signer: z.string().min(1),
  intent: z.string().min(1),
});

export type PreparedCall = z.infer<typeof preparedCallSchema>;

function intentOf(signer: string, receiver: string, calls: Action[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify([signer, receiver, calls], (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    )
    .digest("hex");
}

function unknownTransaction(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.constructor.name === "UnknownTransactionError" ||
      error.constructor.name === "UnknownTransactionOrReceiptError" ||
      /UNKNOWN_TRANSACTION|unknown transaction|doesn't exist/i.test(error.message))
  );
}

export async function sendJournaled(
  signer: Account,
  receiver: string,
  calls: Action[],
  saved: PreparedCall | undefined,
  remember: (prepare: PreparedCall) => void,
) {
  const intent = intentOf(signer.accountId, receiver, calls);
  if (saved !== undefined && saved.intent !== intent)
    throw new Error(
      "The prepared NEAR operation does not match the requested transfer or task action",
    );
  const signed =
    saved === undefined
      ? await signer.createSignedTransaction({ receiverId: receiver, actions: calls })
      : SignedTransaction.decode(Buffer.from(saved.transaction, "base64"));
  const txHash = baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());
  if (
    signed.transaction.signerId !== signer.accountId ||
    signed.transaction.receiverId !== receiver ||
    (saved !== undefined && (saved.txHash !== txHash || saved.signer !== signer.accountId))
  )
    throw new Error("The prepared NEAR transaction failed its signer, receiver or hash check");
  const verified = (response: unknown) => {
    const finalized = readFinalOutcome(response);
    if (finalized.txHash !== txHash || finalized.signer !== signer.accountId)
      throw new Error("The final NEAR response does not match the prepared transaction");
    return finalized;
  };
  if (saved !== undefined) {
    try {
      return verified(
        await signer.provider.viewTransactionStatus({
          txHash,
          accountId: signer.accountId,
          waitUntil: "FINAL",
        }),
      );
    } catch (error) {
      if (!unknownTransaction(error)) throw error;
    }
  } else {
    remember({
      transaction: Buffer.from(signed.encode()).toString("base64"),
      txHash,
      signer: signer.accountId,
      intent,
    });
  }
  return verified(await signer.provider.sendTransactionUntil(signed, "FINAL"));
}
