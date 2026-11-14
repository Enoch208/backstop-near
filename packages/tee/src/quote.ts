import { js_get_collateral, js_verify } from "@phala/dcap-qvl-node";
import { hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";

export const intelPccs = "https://api.trustedservices.intel.com/tdx/certification/v4";

const hex = z.string().regex(/^[0-9a-fA-F]*$/);

const verifiedQuoteSchema = z.object({
  status: z.string(),
  advisory_ids: z.array(z.string()),
  report: z.object({
    TD10: z.object({
      report_data: hex,
      mr_td: hex,
      rt_mr0: hex,
      rt_mr1: hex,
      rt_mr2: hex,
      rt_mr3: hex,
    }),
  }),
});

export type VerifiedQuote = {
  readonly status: string;
  readonly advisoryIds: readonly string[];
  readonly reportData: string;
  readonly mrTd: string;
  readonly rtmr: readonly string[];
};

export type CollateralSource = (quote: Uint8Array) => Promise<unknown>;

export const intelCollateral: CollateralSource = async (quote) =>
  (await js_get_collateral(intelPccs, quote)) as unknown;

export const acceptableTcb = new Set(["UpToDate", "OutOfDate"]);

export async function verifyQuote(
  quoteHex: string,
  collateral: CollateralSource,
  nowMs: number,
): Promise<VerifiedQuote> {
  const quote = hexToBytes(quoteHex);
  const evidence = await collateral(quote);
  const result = verifiedQuoteSchema.parse(
    js_verify(quote, evidence, BigInt(Math.floor(nowMs / 1000))) as unknown,
  );
  const td = result.report.TD10;
  return {
    status: result.status,
    advisoryIds: result.advisory_ids,
    reportData: td.report_data.toLowerCase(),
    mrTd: td.mr_td.toLowerCase(),
    rtmr: [td.rt_mr0, td.rt_mr1, td.rt_mr2, td.rt_mr3].map((value) => value.toLowerCase()),
  };
}

export function bindsSigner(reportData: string, signingAddress: string, nonce: string): boolean {
  const address = signingAddress.slice(2).toLowerCase().padEnd(64, "0");
  return reportData === `${address}${nonce.toLowerCase()}`;
}
