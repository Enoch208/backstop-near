import { digestSchema } from "@backstop/shared";
import { z } from "zod";

const amount = z.string().regex(/^\d+$/);
export const repairReportSchema = z.object({
  taskId: z.string(),
  state: z.enum(["SETTLED", "FAILURE_SETTLED"]),
  network: z.literal("testnet"),
  mode: z.literal("live-ai"),
  fault: z.enum(["none", "primary-after-checkpoint", "recovery-unavailable"]),
  verified: z.boolean(),
  artifactHash: digestSchema.optional(),
  evidenceHash: digestSchema.optional(),
  suiteHash: digestSchema.optional(),
  checks: z
    .object({ passed: z.number().int().nonnegative(), total: z.number().int().positive() })
    .refine((checks) => checks.passed <= checks.total)
    .optional(),
  model: z.string(),
  recordedAt: z.string(),
  vaultId: z.string(),
  transactions: z.array(
    z.object({
      txHash: z.string(),
      label: z.string(),
      ok: z.boolean(),
      refusalExpected: z.boolean(),
    }),
  ),
  ledger: z.object({
    state: z.string(),
    total_inflow: amount,
    confirmed_outflow: amount,
    bond_consumed: amount,
    compensation: amount,
    customer_refund: amount,
  }),
  duplicateSettlement: z.object({
    txHash: z.string(),
    rejected: z.boolean(),
    errorCode: z.string().nullable(),
  }),
  teamControlled: z.literal(true),
});

export function nearAmount(yocto: string) {
  const amount = BigInt(yocto);
  const unit = 10n ** 24n;
  const fraction = (amount % unit).toString().padStart(24, "0").replace(/0+$/, "");
  return `${String(amount / unit)}${fraction === "" ? "" : `.${fraction}`} NEAR`;
}
