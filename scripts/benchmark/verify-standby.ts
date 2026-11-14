import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bidHash,
  digestOf,
  digestSchema,
  digestText,
  formatNear,
  fromYocto,
  leadAgent,
  near,
  recoveryFeedbackSchema,
  recoveryStrategies,
  signedBidSchema,
  verifyValue,
  yoctoSchema,
} from "@backstop/shared";
import { z } from "zod";
import { check, prepare } from "./evaluate.js";
import { inferenceSchema, limits } from "./inference.js";
import { benchmarkFaults } from "./live-pair.js";
import type { TaskDefinition } from "./tasks.js";

const events = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bid_submitted"), bid: signedBidSchema }),
  z.object({
    type: z.literal("recovery_awarded"),
    epoch: z.int(),
    winner: digestSchema,
    rejected: z.array(z.object({ bidHash: digestSchema, reason: z.string() })),
  }),
  z.object({ type: z.literal("standby_reserved"), bid: signedBidSchema }),
  z.object({ type: z.literal("standby_ready"), bidHash: digestSchema, epoch: z.int() }),
  z.object({ type: z.literal("standby_activated"), bidHash: digestSchema, epoch: z.int() }),
  z.object({ type: z.literal("attempt_assigned"), bid: signedBidSchema, attempt: z.int() }),
  z.object({
    type: z.literal("attempt_failed"),
    attempt: z.int(),
    reason: z.string(),
    agents: z.array(z.string()),
    reportedBy: z.string().optional(),
    fencingToken: z.int().positive().optional(),
  }),
  z.object({
    type: z.literal("attempt_rejected"),
    attempt: z.int(),
    reason: z.string(),
    agents: z.array(z.string()),
  }),
  z.object({ type: z.literal("recovery_opened"), epoch: z.int(), closesAtMs: z.int() }),
  z.object({
    type: z.literal("checkpoint_recorded"),
    checkpoint: z.object({ contentHash: digestSchema, attempt: z.int() }),
  }),
  z.object({ type: z.literal("settlement_started") }),
  z.object({ type: z.literal("task_settled"), kind: z.enum(["success", "failure"]) }),
]);
const trial = z.object({
  task: z.string(),
  taskId: z.string(),
  fault: z.enum(benchmarkFaults),
  mode: z.enum(["fixed", "market"]),
  fixedOrder: z.array(z.string()).optional(),
  routingStrategy: z.enum(recoveryStrategies).optional(),
  feedback: z.array(recoveryFeedbackSchema).optional(),
  repeat: z.int().positive(),
  accepted: z.boolean(),
  correct: z.boolean(),
  elapsedMs: z.int().nonnegative(),
  deadlineMs: z.int().optional(),
  sharedPrimaryHash: digestSchema.nullable(),
  deliveredSource: z.string().nullable(),
  attempts: z
    .array(z.object({ agent: z.string(), provider: z.string(), inference: inferenceSchema }))
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
  pilot: z.boolean().optional(),
  repeats: z.int().positive().optional(),
  fixedPolicy: z.literal("ascending quoted price in each tier").optional(),
  quotes: z.array(z.object({ id: z.string(), price: z.string(), standby: z.boolean() })).optional(),
  routed: z.boolean().optional(),
  diversify: z.boolean().optional(),
  bounded: z.boolean().optional(),
  agentFailureDomains: z.record(z.string(), z.string().min(1)).optional(),
  auctionPolicy: z.literal("lowest eligible quote; strategy breaks price ties only").optional(),
  bidWindowMs: z.int().positive().optional(),
  standbyHoldMs: z.int().nonnegative().optional(),
  limits: z.object({
    calls: z.int(),
    maxPromptBytes: z.int(),
    maxOutputTokens: z.int(),
    maxSourceBytes: z.int(),
    wallMs: z.int(),
    callMs: z.int(),
  }),
  budgetNear: z.object({
    escrow: z.string(),
    premium: z.string(),
    bond: z.string(),
    capacity: z.string(),
  }),
  trials: z.array(trial),
});

function summarize(rows: readonly z.infer<typeof trial>[]) {
  const correct = rows.filter((row) => row.correct).length;
  const costs = rows.flatMap(({ transfers }) =>
    transfers.filter(({ purpose }) =>
      ["payout", "premium_earned", "compensation"].includes(purpose),
    ),
  );
  const total = costs.reduce((sum, { amountYocto }) => sum + fromYocto(amountYocto), 0n);
  const bond = costs
    .filter(({ pool }) => pool === "bond")
    .reduce((sum, { amountYocto }) => sum + fromYocto(amountYocto), 0n);
  const p95 = rows.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b)[
    Math.ceil(rows.length * 0.95) - 1
  ];
  return {
    trials: rows.length,
    correct,
    falseAccepts: rows.filter((row) => row.accepted && !row.correct).length,
    p95Ms: p95 ?? null,
    totalSettlementNear: formatNear(total),
    settlementNearPerCorrect: correct > 0 ? formatNear(total / BigInt(correct)) : null,
    bondConsumedNear: formatNear(bond),
  };
}

export function verifyStandbyRun(path: string, definitions: readonly TaskDefinition[]) {
  const report = reportSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (report.diversify) assert(report.agentFailureDomains !== undefined);
  assert.equal(report.corpusHash, digestOf(definitions));
  assert.equal(report.completedTrials, report.expectedTrials);
  assert.equal(report.trials.length, report.expectedTrials);
  assert.deepEqual(report.limits, limits);
  assert.deepEqual(report.budgetNear, {
    escrow: "0.40",
    premium: "0.04",
    bond: "0.25",
    capacity: "0.65",
  });
  const pairs = new Map<
    string,
    { hash: string; mode: string; correct: boolean; assignments: string[] }
  >();
  const selected = report.pilot ? definitions.slice(0, 1) : definitions;
  const tasks = new Map(selected.map((task) => [task.id, prepare(task)]));
  if (report.repeats !== undefined)
    assert.equal(
      report.expectedTrials,
      selected.length * benchmarkFaults.length * report.repeats * 2,
    );
  const quotes = new Map(report.quotes?.map(({ id, price }) => [id, near(price)]));
  const fixedOrder = (report.quotes ?? [])
    .filter(({ id }) => id !== "blind-primary")
    .sort((a, b) => {
      const byTier = Number(a.standby) - Number(b.standby);
      if (byTier !== 0) return byTier;
      const left = near(a.price);
      const right = near(b.price);
      return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
    })
    .map(({ id }) => id);
  const seen = new Set<string>();
  let deliveries = 0;
  let standby = 0;
  let matchingAssignments = 0;
  let matchingFirstRecovery = 0;
  let differentFirstRecovery = 0;
  let verifiedFeedback = 0;
  let marketWins = 0;
  let fixedWins = 0;
  let diversificationAwards = 0;
  let diversificationOpportunities = 0;
  let timeoutDiversificationAwards = 0;
  let timeoutDiversificationOpportunities = 0;
  let workerFailureReports = 0;
  for (const row of report.trials) {
    if (report.diversify) {
      assert(row.deadlineMs !== undefined);
      for (const attempt of row.attempts)
        assert.equal(
          report.agentFailureDomains?.[attempt.agent],
          attempt.provider,
          "Configured failure domain differs from the executed provider",
        );
    }
    for (const { inference } of row.attempts) {
      if (inference.promptBytes > limits.maxPromptBytes)
        assert.equal(inference.status, "prompt-too-large");
      if (inference.source !== null) {
        assert.equal(inference.status, "ok");
        assert(Buffer.byteLength(inference.source) <= limits.maxSourceBytes);
        assert(inference.outputTokens === null || inference.outputTokens <= limits.maxOutputTokens);
      }
    }
    assert(
      row.transfers
        .filter(
          ({ pool, purpose }) =>
            pool === "bond" && (purpose === "payout" || purpose === "compensation"),
        )
        .reduce((sum, { amountYocto }) => sum + fromYocto(amountYocto), 0n) <= near("0.25"),
    );
    const task = tasks.get(row.task);
    assert(task !== undefined);
    assert.equal(row.taskId, `${row.task}-${row.fault}-${String(row.repeat)}-${row.mode}`);
    if (report.repeats !== undefined) assert(row.repeat <= report.repeats);
    if (report.fixedPolicy !== undefined && row.mode === "fixed")
      assert.deepEqual(row.fixedOrder, fixedOrder);
    assert(!seen.has(row.taskId));
    seen.add(row.taskId);
    const commits = new Map<string, { index: number; signer: string }>();
    const ready = new Set<string>();
    const offered: z.infer<typeof signedBidSchema>[] = [];
    const closes = new Map<number, number>();
    const checkpoints = [];
    const checkpointByAttempt = new Map<number, string>();
    const submitted = new Set<string>();
    if (report.routed) {
      assert(row.routingStrategy !== undefined);
      assert(row.feedback !== undefined);
    }
    let primaryCheckpoint = null;
    const assigned: z.infer<typeof signedBidSchema>[] = [];
    const rejectedAttempts = new Map<number, readonly string[]>();
    const timeoutAttempts = new Map<number, readonly string[]>();
    for (const [index, { body }] of row.events.entries()) {
      if (
        body.type === "attempt_failed" &&
        ["PROVIDER_TIMEOUT", "PROMPT_LIMIT", "INVALID_OUTPUT"].includes(body.reason)
      ) {
        assert(report.bounded);
        const assignment = assigned.at(-1);
        assert(
          assignment !== undefined &&
            body.reportedBy !== undefined &&
            body.fencingToken !== undefined,
        );
        assert.equal(body.reportedBy, leadAgent(assignment.bid));
        assert.equal(body.fencingToken, body.attempt);
        assert.equal(body.attempt, assigned.length);
        assert.deepEqual(
          body.agents,
          assignment.bid.members.map(({ agentId }) => agentId),
        );
        const inference = row.attempts.find(({ agent }) => agent === body.reportedBy)?.inference;
        assert(inference !== undefined);
        assert.equal(
          inference.status,
          body.reason === "PROVIDER_TIMEOUT"
            ? "provider-timeout"
            : body.reason === "PROMPT_LIMIT"
              ? "prompt-too-large"
              : "invalid-or-truncated-code",
        );
        if (body.reason === "PROVIDER_TIMEOUT") timeoutAttempts.set(body.attempt, body.agents);
        workerFailureReports++;
      }
      if (body.type === "attempt_rejected" && body.reason === "VERDICT_REJECTED")
        rejectedAttempts.set(body.attempt, body.agents);
      if (body.type === "recovery_opened") {
        closes.set(body.epoch, body.closesAtMs);
        if (report.bidWindowMs !== undefined)
          assert.equal(body.closesAtMs - (row.events[index]?.atMs ?? 0), report.bidWindowMs);
      }
      if (body.type === "checkpoint_recorded") {
        checkpoints.push(body.checkpoint.contentHash);
        checkpointByAttempt.set(body.checkpoint.attempt, body.checkpoint.contentHash);
        if (body.checkpoint.attempt === 1) primaryCheckpoint = body.checkpoint.contentHash;
      }
      if (
        body.type === "standby_reserved" ||
        body.type === "attempt_assigned" ||
        body.type === "bid_submitted"
      ) {
        const signed = body.bid;
        if (body.type !== "attempt_assigned") offered.push(signed);
        assert.equal(signed.bid.taskId, row.taskId);
        assert.equal(signed.bidHash, bidHash(signed.bid));
        assert(verifyValue(signed.bid, signed.signature));
        if (body.type === "standby_reserved") {
          assert.equal(signed.bid.purpose, "standby");
          commits.set(signed.bidHash, { index, signer: signed.signature.publicKey });
        } else if (body.type === "attempt_assigned") {
          assert(fromYocto(signed.bid.amountYocto) <= near("0.65"));
          if (report.auctionPolicy !== undefined && signed.bid.epoch > 0) {
            const used = new Set(
              assigned.flatMap(({ bid }) => bid.members.map(({ agentId }) => agentId)),
            );
            const tier = signed.bid.purpose === "standby";
            const eligible = offered.filter(
              ({ bid, bidHash }) =>
                bid.epoch === signed.bid.epoch &&
                bid.expiresAtMs >= (row.events[index]?.atMs ?? 0) &&
                fromYocto(bid.amountYocto) <= near("0.65") &&
                !bid.members.some(({ agentId }) => used.has(agentId)) &&
                (bid.purpose !== "standby" ||
                  (ready.has(bidHash) &&
                    (row.deadlineMs === undefined ||
                      bid.estimatedDurationMs <= row.deadlineMs - (row.events[index]?.atMs ?? 0)))),
            );
            const domains = [body.attempt - 1].map((attempt) => {
              const timeout = report.bounded ? timeoutAttempts.get(attempt) : undefined;
              const agents = timeout ?? rejectedAttempts.get(attempt);
              const agent = agents?.length === 1 ? agents[0] : undefined;
              const feedback = row.feedback?.find((entry) => entry.attempt === attempt);
              return agent !== undefined &&
                (timeout !== undefined ||
                  (feedback !== undefined &&
                    checkpointByAttempt.get(attempt) === feedback.artifactHash))
                ? report.agentFailureDomains?.[agent]
                : undefined;
            });
            const diversify =
              report.diversify === true &&
              row.mode === "market" &&
              (body.attempt === limits.calls ||
                (report.bounded && timeoutAttempts.has(body.attempt - 1))) &&
              typeof domains[0] === "string" &&
              domains[0].length > 0;
            const independent = diversify
              ? eligible.filter(
                  ({ bid }) =>
                    bid.estimatedDurationMs <=
                      (row.deadlineMs ?? 0) - (row.events[index]?.atMs ?? 0) &&
                    bid.members.every(({ agentId }) => {
                      const domain = report.agentFailureDomains?.[agentId];
                      return (
                        typeof domain === "string" && domain.length > 0 && domain !== domains[0]
                      );
                    }),
                )
              : [];
            if (diversify) {
              diversificationOpportunities++;
              if (timeoutAttempts.has(body.attempt - 1)) timeoutDiversificationOpportunities++;
            }
            const available =
              independent.length > 0
                ? independent
                : eligible.filter(({ bid }) =>
                    tier ? bid.purpose === "standby" : bid.purpose !== "standby",
                  );
            if (independent.length > 0) {
              assert(
                independent.some(({ bidHash }) => bidHash === signed.bidHash),
                "Recovery did not diversify after an eligible rejection or reported timeout",
              );
              diversificationAwards++;
              if (timeoutAttempts.has(body.attempt - 1)) timeoutDiversificationAwards++;
            } else if (tier) {
              assert(
                !eligible.some(({ bid }) => bid.purpose !== "standby"),
                "Activated standby ahead of eligible ordinary offers without a justified override",
              );
            }
            assert(available.length > 0);
            const cheapest = available
              .map(({ bid }) => fromYocto(bid.amountYocto))
              .reduce((a, b) => (a < b ? a : b));
            assert.equal(
              fromYocto(signed.bid.amountYocto),
              cheapest,
              "Paid more than the cheapest eligible quote under the declared routing policy",
            );
          }
          assigned.push(signed);
          if (report.fixedPolicy !== undefined && signed.bid.epoch > 0)
            assert.equal(fromYocto(signed.bid.amountYocto), quotes.get(leadAgent(signed.bid)));
          if (signed.bid.purpose === "standby") {
            assert(ready.has(signed.bidHash));
            const award = row.events[index - 1]?.body;
            const activation =
              row.events[index - (award?.type === "recovery_awarded" ? 2 : 1)]?.body;
            assert(activation?.type === "standby_activated");
            assert.equal(activation.bidHash, signed.bidHash);
            standby++;
          }
        }
      }
      if (body.type === "standby_ready") {
        assert(commits.has(body.bidHash));
        if (report.standbyHoldMs !== undefined) {
          const close = closes.get(body.epoch);
          assert(close !== undefined);
          assert((row.events[index]?.atMs ?? 0) <= close + report.standbyHoldMs);
        }
        ready.add(body.bidHash);
      }
      if (body.type === "bid_submitted") submitted.add(body.bid.bidHash);
      if (body.type === "recovery_awarded") {
        assert(submitted.has(body.winner) || ready.has(body.winner));
        const assignment = row.events[index + 1]?.body;
        assert(assignment?.type === "attempt_assigned");
        assert.equal(assignment.bid.bidHash, body.winner);
        assert.equal(assignment.bid.bid.epoch, body.epoch);
      }
    }
    for (const feedback of row.feedback ?? []) {
      assert.equal(checkpointByAttempt.get(feedback.attempt), feedback.artifactHash);
      assert(
        feedback.publicFailedCaseIds.every((id) => task.visible.some((test) => test.id === id)),
      );
      verifiedFeedback++;
    }
    assert(assigned.length > 0 && assigned.length <= limits.calls);
    assert.equal(commits.size, 4);
    assert.equal(new Set([...commits.values()].map(({ signer }) => signer)).size, 2);
    const primaryIndex = row.events.findIndex(({ body }) => body.type === "attempt_assigned");
    assert([...commits.values()].every(({ index }) => index < primaryIndex));
    const pairKey = `${row.task}/${row.fault}/${String(row.repeat)}`;
    const hash = digestOf([row.sharedPrimaryHash, primaryCheckpoint]);
    const assignments = assigned.map(({ bid }) => leadAgent(bid));
    const pair = pairs.get(pairKey);
    if (pair === undefined)
      pairs.set(pairKey, { hash, mode: row.mode, correct: row.correct, assignments });
    else {
      assert.equal(hash, pair.hash);
      assert.notEqual(row.mode, pair.mode);
      if (JSON.stringify(assignments) === JSON.stringify(pair.assignments)) matchingAssignments++;
      if (assignments[1] === pair.assignments[1]) matchingFirstRecovery++;
      else if (assignments[1] !== undefined && pair.assignments[1] !== undefined)
        differentFirstRecovery++;
      if (pair.correct !== row.correct) {
        if (row.correct ? row.mode === "market" : pair.mode === "market") marketWins++;
        else fixedWins++;
      }
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
  const byMode = Object.fromEntries(
    (["market", "fixed"] as const).map((mode) => {
      const rows = report.trials.filter((row) => row.mode === mode);
      return [
        mode,
        {
          overall: summarize(rows),
          byFault: Object.fromEntries(
            benchmarkFaults.map((fault) => [
              fault,
              summarize(rows.filter((row) => row.fault === fault)),
            ]),
          ),
        },
      ];
    }),
  );
  return {
    trials: report.trials.length,
    pairs: pairs.size,
    deliveries,
    standby,
    matchingAssignments,
    matchingFirstRecovery,
    differentFirstRecovery,
    verifiedFeedback,
    diversificationAwards,
    diversificationOpportunities,
    timeoutDiversificationAwards,
    timeoutDiversificationOpportunities,
    workerFailureReports,
    marketWins,
    fixedWins,
    byMode,
  };
}
