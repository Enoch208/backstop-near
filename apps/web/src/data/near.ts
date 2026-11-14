import { useEffect, useState } from "react";
import { z } from "zod";
import { record } from "./record.js";

export const rpc = "https://test.rpc.fastnear.com";

const responseSchema = z.object({
  result: z.object({ result: z.array(z.number()) }).optional(),
  error: z.unknown().optional(),
});

export async function viewVault(method: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: record.contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const parsed = responseSchema.parse(await response.json());
  if (parsed.result === undefined) throw new Error(`NEAR RPC refused ${method}`);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(parsed.result.result))) as unknown;
}

export const ledgerSchema = z.object({
  state: z.string(),
  total_inflow: z.string(),
  confirmed_outflow: z.string(),
  pending_outflow: z.string(),
  failed_outflow: z.string(),
  bond_consumed: z.string(),
  inflow_bond: z.string(),
  confirmed_by_recipient: z.array(z.object({ recipient: z.string(), amount: z.string() })),
});
export type ChainLedger = z.infer<typeof ledgerSchema>;

export const inferenceSchema = z.object({
  model: z.string(),
  signer: z.string(),
  request_hash: z.string(),
  response_hash: z.string(),
  artifact_hash: z.string(),
  attempt: z.number(),
});
export type ChainInference = z.infer<typeof inferenceSchema>;

export type Reading<T> =
  | { readonly status: "loading" }
  | { readonly status: "ok"; readonly value: T; readonly readAt: Date }
  | { readonly status: "failed"; readonly message: string };

export function useVaultView<T>(
  method: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Reading<T> {
  const [reading, setReading] = useState<Reading<T>>({ status: "loading" });
  const key = JSON.stringify(args);
  useEffect(() => {
    let live = true;
    viewVault(method, JSON.parse(key) as Record<string, unknown>)
      .then((value) => {
        if (live) setReading({ status: "ok", value: schema.parse(value), readAt: new Date() });
      })
      .catch((error: unknown) => {
        if (live)
          setReading({
            status: "failed",
            message: error instanceof Error ? error.message : "NEAR RPC unreachable",
          });
      });
    return () => {
      live = false;
    };
  }, [method, key, schema]);
  return reading;
}

const yoctoPerNear = 10n ** 24n;

export function nearAmount(yocto: string, digits = 2): string {
  const value = BigInt(yocto);
  const whole = value / yoctoPerNear;
  const fraction = (value % yoctoPerNear).toString().padStart(24, "0").slice(0, digits);
  return `${whole.toString()}.${fraction}`;
}
