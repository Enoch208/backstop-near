import { digestSchema, yoctoSchema, type Digest } from "@backstop/shared";
import { z } from "zod";

export const hex32Schema = z.string().regex(/^[0-9a-f]{64}$/);
export type Hex32 = z.infer<typeof hex32Schema>;

export function toHex32(digest: Digest): Hex32 {
  return hex32Schema.parse(digestSchema.parse(digest).slice("sha256:".length));
}

export function fromHex32(hex: Hex32): Digest {
  return `sha256:${hex}`;
}

export const vaultStates = [
  "FUNDED",
  "ASSIGNED",
  "RECOVERY_OPEN",
  "ACCEPTED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "TERMINAL_FAILURE",
  "FAILURE_SETTLEMENT_PENDING",
  "FAILURE_SETTLED",
] as const;

export const ledgerViewSchema = z.object({
  task_id: z.string(),
  state: z.enum(vaultStates),
  state_version: z.int(),
  total_inflow: yoctoSchema,
  escrow_available: yoctoSchema,
  premium_available: yoctoSchema,
  bond_available: yoctoSchema,
  bond_consumed: yoctoSchema,
  pending_outflow: yoctoSchema,
  failed_outflow: yoctoSchema,
  confirmed_outflow: yoctoSchema,
  confirmed_by_recipient: z.array(z.object({ recipient: z.string(), amount: yoctoSchema })),
});
export type LedgerView = z.infer<typeof ledgerViewSchema>;

export const transferViewSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  recipient: z.string(),
  amount: yoctoSchema,
  pool: z.enum(["ESCROW", "PREMIUM", "BOND"]),
  status: z.enum(["PENDING", "CONFIRMED", "FAILED"]),
  retries: z.int(),
});
export type TransferView = z.infer<typeof transferViewSchema>;

export const rolesSchema = z.object({
  owner: z.string(),
  coordinator: z.string(),
  verifier: z.string(),
});

const eventData = z.looseObject({
  task_id: z.string().optional(),
  state_version: z.int().optional(),
});

export const vaultEventSchema = z.object({
  standard: z.literal("backstop"),
  version: z.string(),
  event: z.string(),
  data: z.array(eventData).length(1),
});
export type VaultEvent = { readonly event: string; readonly data: z.infer<typeof eventData> };

export const eventLogPrefix = "EVENT_JSON:";

export function parseEventLog(line: string): VaultEvent | null {
  if (!line.startsWith(eventLogPrefix)) return null;
  const parsed = vaultEventSchema.safeParse(JSON.parse(line.slice(eventLogPrefix.length)));
  const [data] = parsed.success ? parsed.data.data : [];
  return parsed.success && data !== undefined ? { event: parsed.data.event, data } : null;
}
