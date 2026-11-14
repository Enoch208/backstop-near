import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ChainStep } from "./mirror.js";
import { explorerTx } from "./network.js";

export const testnetRecord = fileURLToPath(
  new URL("../../../deployments/testnet.json", import.meta.url),
);

export type RecordedRun = {
  readonly kind: "replay" | "live swarm";
  readonly taskId: string;
  readonly steps: readonly ChainStep[];
  readonly extra: Record<string, unknown>;
};

const documentSchema = z.object({
  contractId: z.string().optional(),
  deployTx: z.string().nullable(),
  upgrades: z.array(z.unknown()).default([]),
  teeSigners: z.array(z.unknown()).default([]),
  keyRestrictions: z.array(z.unknown()).default([]),
  runs: z.array(z.unknown()),
});
type Document = z.infer<typeof documentSchema>;

function load(path: string): Document {
  const previous = documentSchema.safeParse(
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null,
  );
  return previous.success
    ? previous.data
    : { deployTx: null, upgrades: [], teeSigners: [], keyRestrictions: [], runs: [] };
}

function save(path: string, contractId: string, document: Document): void {
  mkdirSync(dirname(path), { recursive: true });
  const ordered = {
    network: "testnet",
    contractId,
    deployTx: document.deployTx,
    upgrades: document.upgrades,
    teeSigners: document.teeSigners,
    ...(document.keyRestrictions.length === 0 ? {} : { keyRestrictions: document.keyRestrictions }),
    runs: document.runs,
  };
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`);
}

export function appendTestnetRun(
  contractId: string,
  deployTx: string | null,
  run: RecordedRun,
  path = testnetRecord,
): void {
  const document = load(path);
  const entry = {
    at: new Date().toISOString(),
    kind: run.kind,
    taskId: run.taskId,
    steps: run.steps.map((step) => ({
      label: step.label,
      txHash: step.call.txHash,
      signer: step.call.signer,
      outcome: step.call.ok ? "success" : `refused ${step.call.errorCode ?? ""}`.trim(),
      explorer: explorerTx(step.call.txHash),
    })),
    ...run.extra,
  };
  save(path, contractId, {
    ...document,
    deployTx: deployTx ?? document.deployTx,
    runs: [...document.runs, entry],
  });
}

export function appendTestnetEntry(
  contractId: string,
  list: "upgrades" | "teeSigners" | "keyRestrictions",
  entry: { readonly txHash: string } & Record<string, unknown>,
  path = testnetRecord,
): void {
  const document = load(path);
  const recorded = {
    at: new Date().toISOString(),
    ...entry,
    explorer: explorerTx(entry.txHash),
  };
  save(path, contractId, { ...document, [list]: [...document[list], recorded] });
}
