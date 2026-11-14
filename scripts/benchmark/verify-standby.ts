import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bidHash,
  digestOf,
  digestSchema,
  digestText,
  fromYocto,
  leadAgent,
  near,
  signedBidSchema,
  verifyValue,
  yoctoSchema,
} from "@backstop/shared";
import { z } from "zod";
import { blindTasks } from "./blind-tasks.js";
import { check, prepare } from "./evaluate.js";
import { limits } from "./inference.js";
import { benchmarkFaults } from "./live-pair.js";

const events = z.discriminatedUnion("type", [
  z.object({ type: z.literal("standby_reserved"), bid: signedBidSchema }),
  z.object({ type: z.literal("standby_ready"), bidHash: digestSchema, epoch: z.int() }),
  z.object({ type: z.literal("standby_activated"), bidHash: digestSchema, epoch: z.int() }),
  z.object({ type: z.literal("attempt_assigned"), bid: signedBidSchema }),
  z.object({ type: z.literal("attempt_failed") }),
  z.object({ type: z.literal("attempt_rejected") }),
  z.object({
    type: z.literal("checkpoint_recorded"),
    checkpoint: z.object({ contentHash: digestSchema }),
  }),
  z.object({ type: z.literal("settlement_started") }),
  z.object({ type: z.literal("task_settled"), kind: z.enum(["success", "failure"]) }),
]);
const trial = z.object({
  task: z.string(),
  taskId: z.string(),
  fault: z.enum(benchmarkFaults),
  mode: z.enum(["fixed", "market"]),
  repeat: z.int().positive(),
  accepted: z.boolean(),
  correct: z.boolean(),
  sharedPrimaryHash: digestSchema.nullable(),
  deliveredSource: z.string().nullable(),
  attempts: z
    .array(z.object({ agent: z.string(), provider: z.string() }))
    .min(1)
    .max(limits.calls),
  events: z.array(z.object({ atMs: z.int(), body: events })),
  transfers: z.array(
    z.object({
      amountYocto: yoctoSchema,
      status: z.literal("CONFIRMED"),
      purpose: z.string(),
      recipient: z.string(),
      pool: z.enum(["escrow", "premium", "bond"]),
    }),
  ),
});
const reportSchema = z.object({
  corpusHash: digestSchema,
  expectedTrials: z.int(),
  completedTrials: z.int(),
  trials: z.array(trial),
});

export function verifyStandbyRun(path: string) {
  const report = reportSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  assert.equal(report.corpusHash, digestOf(blindTasks));
  assert.equal(report.completedTrials, report.expectedTrials);
  assert.equal(report.trials.length, report.expectedTrials);
  const pairs = new Map<string, { hash: string; mode: string }>();
  const tasks = new Map(blindTasks.map((task) => [task.id, prepare(task)]));
  const seen = new Set<string>();
  let deliveries = 0;
  let standby = 0;
  for (const row of report.trials) {
    const task = tasks.get(row.task);
    assert(task !== undefined);
    assert(!seen.has(row.taskId));
    seen.add(row.taskId);
    const commits = new Map<string, { index: number; signer: string }>();
    const ready = new Set<string>();
    const checkpoints = [];
    const assigned = [];
    for (const [index, { body }] of row.events.entries()) {
      if (body.type === "checkpoint_recorded") checkpoints.push(body.checkpoint.contentHash);
      if (body.type === "standby_reserved" || body.type === "attempt_assigned") {
        const signed = body.bid;
        assert.equal(signed.bid.taskId, row.taskId);
        assert.equal(signed.bidHash, bidHash(signed.bid));
        assert(verifyValue(signed.bid, signed.signature));
        if (body.type === "standby_reserved") {
          assert.equal(signed.bid.purpose, "standby");
          commits.set(signed.bidHash, { index, signer: signed.signature.publicKey });
        } else {
          assigned.push(signed);
          if (signed.bid.purpose === "standby") {
            assert(ready.has(signed.bidHash));
            const activation = row.events[index - 1]?.body;
            assert(activation?.type === "standby_activated");
            assert.equal(activation.bidHash, signed.bidHash);
            standby++;
          }
        }
      }
      if (body.type === "standby_ready") {
        assert(commits.has(body.bidHash));
        ready.add(body.bidHash);
      }
    }
    assert(assigned.length > 0 && assigned.length <= limits.calls);
    assert.equal(commits.size, 4);
    assert.equal(new Set([...commits.values()].map(({ signer }) => signer)).size, 2);
    const primaryIndex = row.events.findIndex(({ body }) => body.type === "attempt_assigned");
    assert([...commits.values()].every(({ index }) => index < primaryIndex));
    const pairKey = `${row.task}/${row.fault}/${String(row.repeat)}`;
    const hash = digestOf([row.sharedPrimaryHash, checkpoints[0] ?? null]);
    const pair = pairs.get(pairKey);
    if (pair === undefined) pairs.set(pairKey, { hash, mode: row.mode });
    else {
      assert.equal(hash, pair.hash);
      assert.notEqual(row.mode, pair.mode);
    }
    if (row.fault === "primary-provider-outage")
      assert(assigned.slice(1).every((bid) => bid.bid.purpose === "standby"));
    assert.equal(
      row.transfers.reduce((sum, { amountYocto }) => sum + fromYocto(amountYocto), 0n),
      near("0.69"),
    );
    const award = assigned.at(-1);
    if (row.deliveredSource === null) {
      assert(!row.accepted && !row.correct);
      assert(!row.transfers.some(({ purpose }) => purpose === "payout"));
    } else {
      assert(row.accepted && award !== undefined);
      assert.equal(digestText(row.deliveredSource), checkpoints.at(-1));
      assert.equal(check(row.deliveredSource, task.entry, task.acceptance).length, 0);
      assert.equal(check(row.deliveredSource, task.entry, task.audit).length === 0, row.correct);
      const payout = row.transfers.filter(({ purpose }) => purpose === "payout");
      assert.equal(
        payout.reduce((sum, { amountYocto }) => sum + fromYocto(amountYocto), 0n),
        fromYocto(award.bid.amountYocto),
      );
      assert(
        payout.every(({ recipient }) =>
          award.bid.members.some(({ account }) => account === recipient),
        ),
      );
      assert.equal(row.attempts.at(-1)?.agent, leadAgent(award.bid));
      deliveries++;
    }
  }
  assert.equal(report.trials.length, pairs.size * 2);
  return { trials: report.trials.length, pairs: pairs.size, deliveries, standby };
}
