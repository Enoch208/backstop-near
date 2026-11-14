import { principals, roster, type ModelConfig } from "@backstop/agents";
import { createRuntime, startApi } from "@backstop/api";
import { checkoutManifest } from "@backstop/fixture-checkout";
import {
  digestOf,
  digestText,
  formatNear,
  near,
  repairRunnerId,
  repairTaskSchema,
  suiteHash,
  terminalStates,
  toYocto,
} from "@backstop/shared";
import { apiClient, type Reply } from "@backstop/workers";
import { z } from "zod";
import { check, type PreparedTask } from "./evaluate.js";
import { inferenceSchema, limits } from "./inference.js";
import { operatorSpecs, startOperator } from "./operator-process.js";

export const benchmarkFaults = [
  "healthy",
  "worker-crash",
  "primary-provider-outage",
  "rejected-output",
] as const;
type Fault = (typeof benchmarkFaults)[number];
type Mode = "market" | "fixed";
const rebuildTasks = new Set(["he-119", "he-129", "he-132", "he-154"]);
const preferredStrategy = (taskId: string) => (rebuildTasks.has(taskId) ? "rebuild" : "patch");
const resultSchema = z.object({ inference: inferenceSchema.nullable(), status: z.string() });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requireOk(reply: Promise<Reply>) {
  const result = await reply;
  if (result.status >= 300)
    throw new Error(`HTTP ${String(result.status)}: ${JSON.stringify(result.body)}`);
}

export async function createBenchLane(
  statePath: string,
  primary: ModelConfig,
  secondary: ModelConfig,
  priceAwareFixed = false,
  routed = false,
  hardened = false,
  diversify = false,
  bounded = false,
) {
  const failureDomains = Object.fromEntries([
    [roster.alpha.agentId, new URL(primary.baseUrl).hostname],
    ...operatorSpecs.map(
      (spec) =>
        [spec.id, new URL((spec.secondary ? secondary : primary).baseUrl).hostname] as const,
    ),
  ]);
  const runtime = createRuntime(Date.now, false, statePath, diversify ? failureDomains : undefined);
  const api = await startApi(runtime, "127.0.0.1", 0, 30);
  const all = await Promise.allSettled(
    operatorSpecs.map((spec) =>
      startOperator(
        api.url,
        spec,
        spec.secondary ? secondary : primary,
        routed && spec.id !== "blind-primary"
          ? spec.id.endsWith("-low") || spec.id === "blind-low-bid"
            ? "patch"
            : "rebuild"
          : undefined,
        hardened,
        bounded,
      ),
    ),
  );
  const operators = all.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
  const stop = async () => {
    await Promise.allSettled(operators.map((operator) => operator.stop()));
    await api.close();
  };
  const rejected = all.find((item) => item.status === "rejected");
  if (rejected !== undefined) {
    await stop();
    throw rejected.reason;
  }
  const customer = apiClient(api.url, principals.customer);
  const guarantor = apiClient(api.url, principals.guarantor);
  const registeredPrimary = operators.find((operator) => operator.id === "blind-primary");
  if (registeredPrimary === undefined) throw new Error("Primary operator missing");
  const main = registeredPrimary;
  const bids = operators.filter((operator) => operator !== main && !operator.standby);
  const standby = operators.filter((operator) => operator.standby);

  function record(taskId: string) {
    const task = runtime.store.records[taskId];
    if (task === undefined) throw new Error(`Missing task ${taskId}`);
    return task;
  }

  async function trial(
    task: PreparedTask,
    fault: Fault,
    repeat: number,
    mode: Mode,
    sharedPrimary: (taskId: string) => Promise<z.infer<typeof inferenceSchema>>,
  ) {
    const taskId = `${task.id}-${fault}-${String(repeat)}-${mode}`;
    const base = `/api/tasks/${taskId}`;
    const fixedRoster = [...bids, ...standby];
    if (priceAwareFixed) {
      fixedRoster.sort((left, right) => {
        const a = near(left.price);
        const b = near(right.price);
        return a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id);
      });
    }
    const fixedOrder = fixedRoster.map(({ id }) => id);
    const repairTask = repairTaskSchema.parse({
      objective: task.objective,
      rules: task.rules,
      source: task.starter,
      suite: task.suite,
    });
    const manifest = {
      ...checkoutManifest({ taskId, createdAtMs: Date.now(), maxAttempts: limits.calls }),
      objective: task.objective,
      repairTaskHash: digestOf(repairTask),
      deadlineMs: Date.now() + limits.wallMs,
      suite: {
        suiteId: task.suite.suiteId,
        suiteHash: suiteHash(task.suite),
        runnerId: repairRunnerId,
      },
      guarantee: {
        maxLiabilityYocto: toYocto(near("0.25")),
        compensationCapYocto: toYocto(near("0.15")),
      },
      policy: {
        maxAttempts: limits.calls,
        leaseMs: 1_200,
        heartbeatGraceMs: routed ? 750 : 0,
        bidWindowMs: 1_000,
        challengeWindowMs: 1_000,
        ...(mode === "fixed" ? { recoveryOrder: fixedOrder } : {}),
        ...(routed &&
          mode === "market" && {
            recoveryStrategy: hardened ? "patch" : preferredStrategy(task.id),
          }),
      },
    };
    await requireOk(customer.post("/api/tasks", { manifest, repairTask }));
    await requireOk(
      customer.post(`${base}/funding`, {
        pool: "escrow",
        amountYocto: manifest.budget.escrowYocto,
        liabilityYocto: null,
      }),
    );
    await requireOk(
      customer.post(`${base}/funding`, {
        pool: "premium",
        amountYocto: manifest.budget.premiumYocto,
        liabilityYocto: null,
      }),
    );
    await requireOk(
      guarantor.post(`${base}/funding`, {
        pool: "bond",
        amountYocto: manifest.guarantee.maxLiabilityYocto,
        liabilityYocto: manifest.guarantee.maxLiabilityYocto,
      }),
    );
    await Promise.all(standby.map((operator) => operator.send({ taskId, action: "reserve" })));
    if (record(taskId).standby.length !== standby.length * (limits.calls - 1))
      throw new Error("Missing signed standby commitments before assignment");
    const generationStartedAt = Date.now();
    const initial = await sharedPrimary(taskId);
    const cachedPrimaryDelayMs = Math.max(
      0,
      initial.elapsedMs - (Date.now() - generationStartedAt),
    );
    if (cachedPrimaryDelayMs > 0) await wait(cachedPrimaryDelayMs);
    const available = new Map(operators.map((operator) => [operator.id, operator]));
    const attempts = [{ agent: roster.alpha.agentId, provider: main.host, inference: initial }];
    const execution = await startOperator(
      api.url,
      { ...main, id: "alpha" },
      primary,
      undefined,
      false,
      bounded,
    );
    try {
      const ready = await execution.send({ action: "primary-bid", taskId });
      z.object({ assigned: z.literal(true) }).parse(ready);
      const first = fault === "rejected-output" ? task.mutant : initial.source;
      await execution.send({
        action: "work",
        taskId,
        source: first,
        submit: fault !== "worker-crash" && fault !== "primary-provider-outage",
        ...(bounded &&
        fault === "healthy" &&
        initial.source === null &&
        initial.status === "provider-timeout"
          ? { failureReason: "PROVIDER_TIMEOUT" }
          : {}),
      });
      if (fault === "worker-crash" || fault === "primary-provider-outage") {
        const exit = await execution.stop("SIGKILL");
        if (exit.signal !== "SIGKILL")
          throw new Error("The primary process did not exit by SIGKILL");
      }
    } finally {
      await execution.stop();
    }
    const seen = new Set<string>();
    while (!terminalStates.some((state) => state === record(taskId).state)) {
      const events = runtime.store.streams[taskId] ?? [];
      const action = events.find(
        ({ eventId, body }) =>
          !seen.has(eventId) &&
          (body.type === "recovery_opened" || (body.type === "attempt_assigned" && body.epoch > 0)),
      );
      if (action === undefined) {
        if (Date.now() > manifest.deadlineMs + 3_000)
          throw new Error(`The task did not settle: ${record(taskId).state}`);
        await wait(20);
        continue;
      }
      seen.add(action.eventId);
      const { body } = action;
      if (body.type === "recovery_opened") {
        const enabled = fault === "primary-provider-outage" ? [] : bids;
        const statuses = await Promise.all(
          [...enabled, ...standby]
            .filter(({ id }) => !record(taskId).excludedAgents.includes(id))
            .map((operator) =>
              operator.send({ taskId, action: operator.standby ? "ready" : "bid" }),
            ),
        );
        for (const reply of statuses)
          if (
            !z.object({ status: z.literal(200) }).safeParse(reply).success &&
            !z
              .object({ status: z.literal(409), code: z.literal("BID_WINDOW_CLOSED") })
              .safeParse(reply).success &&
            !(
              z.object({ status: z.literal(409) }).safeParse(reply).success &&
              ["TERMINAL_FAILURE", "FAILURE_SETTLEMENT_PENDING", "FAILURE_SETTLED"].includes(
                record(taskId).state,
              )
            )
          )
            throw new Error(`Benchmark bid refused: ${JSON.stringify(reply)}`);
      } else if (body.type === "attempt_assigned") {
        const selected = available.get(body.bid.bid.members[0]?.agentId ?? "");
        if (selected === undefined) throw new Error("The benchmark awarded an unknown operator");
        const result = resultSchema.parse(await selected.send({ taskId, action: "work" }));
        if (result.inference !== null)
          attempts.push({
            agent: selected.id,
            provider: selected.host,
            inference: result.inference,
          });
      }
    }
    const final = record(taskId);
    const stream = runtime.store.streams[taskId] ?? [];
    const begun = stream.find((item) => item.body.type === "attempt_assigned");
    const settled = stream.at(-1);
    const accepted = final.state === "SETTLED";
    const source =
      accepted && final.candidate !== null
        ? (runtime.artifacts.get(final.candidate.artifactHash) ?? null)
        : null;
    if (accepted && source === null) throw new Error("The coordinator accepted a missing artifact");
    const correct = source !== null && check(source, task.entry, task.audit).length === 0;
    const ledger = final.ledger;
    const changes = stream.filter(({ body }) =>
      [
        "standby_reserved",
        "standby_ready",
        "standby_activated",
        "attempt_assigned",
        "attempt_failed",
        "attempt_rejected",
        "recovery_opened",
        ...(routed ? ["bid_submitted", "recovery_awarded"] : []),
        "checkpoint_recorded",
        "settlement_started",
        "task_settled",
      ].includes(body.type),
    );
    if (begun === undefined || settled?.body.type !== "task_settled")
      throw new Error("Missing benchmark timestamps");
    return {
      taskId,
      task: task.id,
      deadlineMs: manifest.deadlineMs,
      cachedPrimaryDelayMs,
      mode,
      ...(mode === "fixed" && { fixedOrder }),
      ...(routed && {
        routingStrategy: hardened ? "patch" : preferredStrategy(task.id),
        feedback: final.recoveryFeedback,
      }),
      fault,
      repeat,
      correct,
      accepted,
      elapsedMs: settled.atMs - begun.atMs + initial.elapsedMs,
      sharedPrimaryHash: initial.source === null ? null : digestText(initial.source),
      deliveredSource: source,
      initialCheckpoint:
        stream.find(({ body }) => body.type === "checkpoint_recorded")?.body ?? null,
      transfers: ledger.transfers.map(({ amount, ...transfer }) => ({
        ...transfer,
        amountYocto: toYocto(amount),
      })),
      bondConsumedNear: formatNear(ledger.bondConsumed),
      jointNear: formatNear(
        ledger.transfers.reduce(
          (sum, transfer) =>
            sum +
            (transfer.purpose === "payout" ||
            transfer.purpose === "premium_earned" ||
            transfer.purpose === "compensation"
              ? transfer.amount
              : 0n),
          0n,
        ),
      ),
      attempts,
      events: changes,
    };
  }

  return {
    trial,
    stop,
    generate: async (taskId: string) =>
      inferenceSchema.parse(await main.send({ taskId, action: "infer" })),
  };
}
