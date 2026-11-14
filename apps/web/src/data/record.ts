import { z } from "zod";
import raw from "../../../../deployments/testnet.json" with { type: "json" };

const stepSchema = z.object({
  label: z.string(),
  txHash: z.string(),
  outcome: z.string(),
  explorer: z.string(),
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
  runs: z.array(z.object({ taskId: z.string(), steps: z.array(stepSchema) })),
});

export type RecordedStep = z.infer<typeof stepSchema>;

export const record = recordSchema.parse(raw);
export const liveRunId = "checkout-live-71193";

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
