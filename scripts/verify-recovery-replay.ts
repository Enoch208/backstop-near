import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readFinalOutcome,
  signerOf,
  testnetProofProvider,
  testnetRecordSchema,
  verifyLedger,
  type TestnetRecord,
} from "@backstop/near";
import {
  bidHash,
  digestOf,
  digestText,
  fromYocto,
  signedBidSchema,
  verifyValue,
} from "@backstop/shared";
import { z } from "zod";

const taskId = "two-bidders-testnet-1794682474";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const events = z
  .object({
    frames: z.array(
      z.object({ event: z.object({ body: z.record(z.string(), z.unknown()) }).nullable() }),
    ),
  })
  .parse(JSON.parse(read(`../apps/web/public/runs/${taskId}.json`)))
  .frames.flatMap(({ event }) => (event === null ? [] : [event.body]));
const bids = events
  .filter((body) => body.type === "bid_submitted")
  .map((body) => signedBidSchema.parse(body.bid))
  .filter(({ bid }) => bid.epoch === 1);
assert.equal(bids.length, 2);
assert.equal(new Set(bids.map(({ signature }) => signature.publicKey)).size, bids.length);
assert.equal(new Set(bids.map(({ bid }) => bid.members[0]?.account)).size, bids.length);
for (const signed of bids) {
  assert.equal(signed.bid.taskId, taskId);
  assert.equal(signed.bid.members.length, 1);
  assert.equal(signed.bidHash, bidHash(signed.bid));
  assert(verifyValue(signed.bid, signed.signature), "Recovery bid signature did not verify");
}
bids.sort((a, b) => (fromYocto(a.bid.amountYocto) < fromYocto(b.bid.amountYocto) ? -1 : 1));
const [first, second] = bids;
assert(first !== undefined && second !== undefined);
assert(fromYocto(first.bid.amountYocto) < fromYocto(second.bid.amountYocto));
assert.equal(events.find((event) => event.type === "recovery_awarded")?.winner, first.bidHash);
const worker = first.bid.members[0];
assert(worker !== undefined);

const checkpoints = events.filter((event) => event.type === "checkpoint_recorded");
const [primary, replacement] = checkpoints;
assert(primary !== undefined && replacement !== undefined);
assert.equal(primary.checkpointHash, digestOf(primary.checkpoint));
assert.equal(replacement.checkpointHash, digestOf(replacement.checkpoint));
assert.equal(
  z.object({ parentCheckpointHash: z.string() }).parse(replacement.checkpoint).parentCheckpointHash,
  primary.checkpointHash,
);
const artifact = digestText(read(`../apps/web/public/runs/${taskId}.js`));
const submission = events.find((body) => body.type === "artifact_submitted");
assert.equal(submission?.artifactHash, artifact);
assert.equal(submission?.agentId, worker.agentId);
assert.equal(submission?.checkpointHash, replacement.checkpointHash);

const provider = testnetProofProvider(process.env.BACKSTOP_TESTNET_RPC);
const record = testnetRecordSchema.parse(JSON.parse(read("../deployments/testnet.json")));
const steps = record.runs.find((run) => run.taskId === taskId)?.steps;
assert(steps !== undefined);
const root = record.contractId.slice(record.contractId.indexOf(".") + 1);
for (const [label, event, expected] of [
  [
    "commits attempt 2",
    "attempt_assigned",
    {
      attempt: 2,
      bid_hash: first.bidHash.slice(7),
      agent: worker.account,
      amount: first.bid.amountYocto,
    },
  ],
  [
    "vault checks the TEE signature",
    "inference_attested",
    {
      attempt: 2,
      artifact_hash: artifact.slice(7),
    },
  ],
  [
    "finalizes the success settlement",
    "transfer_confirmed",
    {
      recipient: worker.account,
      amount: first.bid.amountYocto,
      transfer_id: `${taskId}:2:0`,
    },
  ],
] as const) {
  const step: TestnetRecord["runs"][number]["steps"][number] | undefined = steps.find((entry) =>
    entry.label.includes(label),
  );
  assert(step !== undefined);
  const response = await provider.viewTransactionStatus({
    txHash: step.txHash,
    accountId: signerOf(step, root),
    waitUntil: "FINAL",
  });
  const transaction = z
    .object({ transaction: z.object({ receiver_id: z.string() }) })
    .parse(response);
  assert.equal(transaction.transaction.receiver_id, record.contractId);
  const call = readFinalOutcome(response);
  assert.equal(call.ok, true);
  assert.equal(call.txHash, step.txHash);
  assert(
    call.events.some(
      ({ event: name, data }) =>
        name === event &&
        data.task_id === taskId &&
        Object.entries(expected).every(([key, value]) => data[key] === value),
    ),
    `Missing ${event} for ${taskId}`,
  );
}
const ledger = await verifyLedger(provider, record.contractId, taskId);
assert(ledger.ok, ledger.detail);
process.stdout.write(
  "Replay verified: both signatures, winning bid, checkpoint lineage, attested artifact, and confirmed payout.\n",
);
