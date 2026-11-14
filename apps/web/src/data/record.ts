import { z } from "zod";
import raw from "../../../../deployments/testnet.json" with { type: "json" };

const stepSchema = z.object({
  label: z.string(),
  txHash: z.string(),
  outcome: z.string(),
  explorer: z.string(),
  signer: z.string().optional(),
});

const recordSchema = z.object({
  contractId: z.string(),
  upgrades: z.array(z.object({ txHash: z.string(), to: z.string(), explorer: z.string() })),
  teeSigners: z.array(
    z.object({
      txHash: z.string(),
      model: z.string(),
      signingAddress: z.string(),
      attestationHash: z.string(),
      tcbStatus: z.string().nullable(),
      explorer: z.string(),
    }),
  ),
  runs: z.array(
    z.object({
      taskId: z.string(),
      at: z.string(),
      kind: z.string().optional(),
      ledgerState: z.string().optional(),
      ledger: z.object({ state: z.string() }).optional(),
      primaryExit: z
        .object({ code: z.number().nullable(), signal: z.string().nullable() })
        .optional(),
      steps: z.array(stepSchema),
    }),
  ),
});

export type RecordedStep = z.infer<typeof stepSchema>;
export type RecordedRun = z.infer<typeof recordSchema>["runs"][number];

export const record = recordSchema.parse(raw);
export const liveRunId = "checkout-live-71193";
export const recoveryProofId = "two-bidders-testnet-1794682474";
export const refundProofId = "recovery-red-team-mwgrr0y8";

const run = record.runs.find((entry) => entry.taskId === liveRunId);
if (run === undefined) throw new Error(`The testnet record has no run ${liveRunId}`);
export const liveRun = run;

const signer = record.teeSigners.at(-1);
if (signer === undefined) throw new Error("The testnet record has no enclave key");
export const enclaveKey = signer;

export const repository = "https://github.com/Enoch208/backstop-near";
export const nearblocks = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const nearblocksAccount = (account: string) =>
  `https://testnet.nearblocks.io/address/${account}`;
export const shortHash = (hash: string) => `${hash.slice(0, 10)}…`;

export const recordedOutcome = (run: RecordedRun) => run.ledgerState ?? run.ledger?.state;

export const runKind = (run: RecordedRun) => run.kind ?? "replay";
export const isRefusal = (step: RecordedStep) => step.outcome.startsWith("refused");
export const attestedStep = (run: RecordedRun) =>
  run.steps.find((step) => step.label.includes("TEE signature"));

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
export const whenUtc = (iso: string) => `${stamp.format(new Date(iso))} UTC`;
