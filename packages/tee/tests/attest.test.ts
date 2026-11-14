import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { attestModel, nearAiAttestationBase, type AttestOptions } from "../src/index.js";

const fixtureSchema = z.object({
  model: z.string(),
  nonce: z.string(),
  recordedAtMs: z.number(),
  report: z.object({ model_attestations: z.array(z.record(z.string(), z.string())) }),
  collateral: z.unknown(),
  nras: z.unknown(),
  jwks: z.unknown(),
});
const recorded = fixtureSchema.parse(
  JSON.parse(readFileSync(new URL("fixtures/deepseek-attestation.json", import.meta.url), "utf8")),
);
const signer = "0xfe0071895500a9755c18044948ab4f4e1a7f337e";

type Overrides = { report?: unknown; nras?: unknown; nonce?: string };

function options(overrides: Overrides = {}): AttestOptions {
  const fetch = (url: string) => {
    const body = url.startsWith(`${nearAiAttestationBase}/attestation/report`)
      ? (overrides.report ?? recorded.report)
      : url.endsWith("/v3/attest/gpu")
        ? (overrides.nras ?? recorded.nras)
        : url.endsWith("/.well-known/jwks.json")
          ? recorded.jwks
          : null;
    return Promise.resolve(
      body === null ? new Response("not found", { status: 404 }) : Response.json(body),
    );
  };
  return {
    baseUrl: nearAiAttestationBase,
    fetch,
    collateral: () => Promise.resolve(recorded.collateral),
    nowMs: recorded.recordedAtMs,
    nonce: overrides.nonce ?? recorded.nonce,
  };
}

const instance = () => ({ ...recorded.report.model_attestations[0] });

describe("NEAR AI Cloud attestation, from a recorded real report", () => {
  it("verifies the Intel TDX quote, the key binding, the nonce and the NVIDIA GPUs", async () => {
    const attestation = await attestModel(recorded.model, options());
    expect(attestation.findings.every((finding) => finding.ok)).toBe(true);
    expect(attestation.signers).toEqual([signer]);
    expect(attestation.instances[0]?.tcbStatus).toBe("UpToDate");
    expect(attestation.instances[0]?.gpu.signatureValid).toBe(true);
    expect(attestation.attestationHash).toMatch(/^sha256:/);
  });

  it("trusts no key when the report answers someone else's nonce", async () => {
    const attestation = await attestModel(recorded.model, options({ nonce: "ab".repeat(32) }));
    expect(attestation.signers).toEqual([]);
    expect(attestation.findings.filter((finding) => !finding.ok).map((f) => f.subject)).toEqual([
      `${signer} nonce`,
      `${signer} binding`,
      `${signer} gpu`,
    ]);
  });

  it("trusts no key when the report claims a signing address the quote does not bind", async () => {
    const forged = { ...instance(), signing_address: "0x6efa5b49c88d75f66013053f4f89c6fbd319d6d9" };
    const attestation = await attestModel(
      recorded.model,
      options({ report: { model_attestations: [forged] } }),
    );
    expect(attestation.signers).toEqual([]);
  });

  it("refuses a quote whose signed body was altered", async () => {
    const quote = instance().intel_quote ?? "";
    const flipped = `${quote.slice(0, 1200)}${quote[1200] === "0" ? "1" : "0"}${quote.slice(1201)}`;
    const altered = { ...instance(), intel_quote: flipped };
    await expect(
      attestModel(recorded.model, options({ report: { model_attestations: [altered] } })),
    ).rejects.toThrow();
  });

  it("refuses an NVIDIA token whose signature does not verify", async () => {
    const nras = z.tuple([z.tuple([z.string(), z.string()])], z.unknown()).parse(recorded.nras);
    const [[kind, token], ...rest] = nras;
    const tampered = `${token.slice(0, -4)}${token.endsWith("AAAA") ? "BBBB" : "AAAA"}`;
    const attestation = await attestModel(
      recorded.model,
      options({ nras: [[kind, tampered], ...rest] }),
    );
    expect(attestation.signers).toEqual([]);
    expect(attestation.instances).toEqual([]);
  });
});
