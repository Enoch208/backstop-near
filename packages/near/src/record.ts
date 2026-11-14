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

const documentSchema = z.object({ runs: z.array(z.unknown()), deployTx: z.string().nullable() });

export function appendTestnetRun(
  contractId: string,
  deployTx: string | null,
  run: RecordedRun,
  path = testnetRecord,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const previous = documentSchema.safeParse(
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null,
  );
  const entry = {
    at: new Date().toISOString(),
    kind: run.kind,
    taskId: run.taskId,
    steps: run.steps.map((step) => ({
      label: step.label,
      txHash: step.call.txHash,
      outcome: step.call.ok ? "success" : `refused ${step.call.errorCode ?? ""}`.trim(),
      explorer: explorerTx(step.call.txHash),
    })),
    ...run.extra,
  };
  const document = {
    network: "testnet",
    contractId,
    deployTx: deployTx ?? (previous.success ? previous.data.deployTx : null),
    runs: [...(previous.success ? previous.data.runs : []), entry],
  };
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}
