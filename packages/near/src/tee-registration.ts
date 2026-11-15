import { z } from "zod";
import { readFinalOutcome } from "./journal.js";
import { hex32Schema } from "./wire.js";

type Registration = {
  readonly txHash: string;
  readonly signingAddress: string;
  readonly model: string;
  readonly attestationHash: string;
};

const transactionSchema = z.object({
  transaction: z.object({
    receiver_id: z.string(),
    actions: z
      .array(z.object({ FunctionCall: z.object({ method_name: z.string(), args: z.base64() }) }))
      .length(1),
  }),
});

const registrationSchema = z.object({
  address: z.string(),
  model: z.string(),
  attestation_hash: hex32Schema,
});

export function matchesTeeRegistration(
  raw: unknown,
  contractId: string,
  recorded: Registration,
): boolean {
  const call = readFinalOutcome(raw);
  const parsed = transactionSchema.safeParse(raw);
  if (!call.ok || call.txHash !== recorded.txHash || !parsed.success) return false;
  const { transaction } = parsed.data;
  const action = transaction.actions[0]?.FunctionCall;
  if (transaction.receiver_id !== contractId || action?.method_name !== "register_tee_signer")
    return false;
  const args = registrationSchema.parse(
    JSON.parse(Buffer.from(action.args, "base64").toString("utf8")),
  );
  const matches = (value: z.infer<typeof registrationSchema>) =>
    value.address === recorded.signingAddress &&
    value.model === recorded.model &&
    value.attestation_hash === recorded.attestationHash.replace(/^sha256:/, "");
  return (
    matches(args) &&
    (call.vaultEvents?.[contractId] ?? []).some((event) => {
      if (event.event !== "tee_signer_registered") return false;
      const data = registrationSchema.safeParse(event.data);
      return data.success && matches(data.data);
    })
  );
}
