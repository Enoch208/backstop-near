import {
  asPrincipal,
  modelFromEnv,
  primaryBid,
  repairPrompt,
  budgetedRepairPrompt,
  PromptBudgetError,
  roster,
  signBid,
  type FixtureAgent,
} from "@backstop/agents";
import {
  digestOf,
  digestText,
  near,
  recoveryFeedbackSchema,
  recoveryStrategies,
  repairBriefSchema,
  signingKeyFromSeed,
  taskManifestSchema,
  toYocto,
  workerFailureReasons,
  type Json,
} from "@backstop/shared";
import {
  apiClient,
  rebuildInstruction,
  registerWorker,
  repairFeedback,
  recoveryStrategyFor,
  publicDiagnosis,
  reserveStandby,
  type Reply,
} from "@backstop/workers";
import { z } from "zod";
import { infer, limits } from "./inference.js";

const settings = z
  .object({
    BENCH_OPERATOR_API: z.url(),
    BENCH_OPERATOR_ID: z.string(),
    BENCH_OPERATOR_SEED: z.string(),
    BENCH_OPERATOR_PRICE: z.string(),
    BENCH_OPERATOR_STYLE: z.string(),
    BENCH_OPERATOR_STRATEGY: z.enum(recoveryStrategies).optional(),
    BENCH_OPERATOR_HARDENED: z.enum(["0", "1"]).default("0"),
    BENCH_OPERATOR_BOUNDED: z.enum(["0", "1"]).default("0"),
  })
  .parse(process.env);
const agent: FixtureAgent =
  settings.BENCH_OPERATOR_ID === "alpha"
    ? roster.alpha
    : {
        agentId: settings.BENCH_OPERATOR_ID,
        account: `${settings.BENCH_OPERATOR_ID}.fixture.testnet`,
        key: signingKeyFromSeed(settings.BENCH_OPERATOR_SEED),
        role: "repairer",
      };
const client = apiClient(settings.BENCH_OPERATOR_API, asPrincipal(agent));
const model = modelFromEnv(process.env);
if (model === null || process.send === undefined)
  throw new Error("Start the benchmark operator from its runner");
if (agent !== roster.alpha) await registerWorker(settings.BENCH_OPERATOR_API, agent);

const request = z.object({
  taskId: z.string(),
  action: z.enum(["reserve", "ready", "primary-bid", "bid", "infer", "work"]),
  source: z.string().nullable().optional(),
  submit: z.boolean().optional(),
  failureReason: z.enum(workerFailureReasons).optional(),
});
const snapshot = z.object({
  task: z.object({
    manifest: taskManifestSchema,
    version: z.int(),
    epoch: z.int(),
    attempt: z.int(),
    checkpoints: z.array(
      z.object({ checkpoint: z.object({ contentHash: z.string() }), hash: z.string() }),
    ),
    failures: z.array(z.object({ reason: z.string() })),
    recoveryFeedback: z.array(recoveryFeedbackSchema).optional(),
  }),
});
function ok(reply: Reply): unknown {
  if (reply.status >= 300)
    throw new Error(`HTTP ${String(reply.status)}: ${JSON.stringify(reply.body)}`);
  return reply.body;
}

async function act({ taskId, action, source, submit, failureReason }: z.infer<typeof request>) {
  const path = `/api/tasks/${taskId}`;
  const { task } = snapshot.parse(ok(await client.get(path)));
  const price = near(settings.BENCH_OPERATOR_PRICE);
  const strategy = settings.BENCH_OPERATOR_STRATEGY;
  if (action === "primary-bid") {
    const bid = primaryBid(agent, taskId, settings.BENCH_OPERATOR_PRICE, Date.now());
    ok(await client.post(`${path}/bids`, { bid }));
    return { assigned: true };
  }
  if (action === "reserve") {
    await reserveStandby(client, agent, task, {
      amount: price,
      durationMs: limits.callMs,
      ...(strategy === undefined ? {} : { strategy }),
    });
    return { reserved: true };
  }
  if (action === "ready") {
    const reply = await client.post(`${path}/standby/ready`, { epoch: task.epoch });
    return {
      status: reply.status,
      code:
        z.object({ error: z.object({ code: z.string() }) }).safeParse(reply.body).data?.error
          .code ?? null,
    };
  }
  if (action === "bid") {
    const now = Date.now();
    const amount = toYocto(price);
    const bid = signBid(
      {
        taskId,
        epoch: task.epoch,
        committedAtMs: now,
        expiresAtMs: task.manifest.deadlineMs,
        members: [
          { agentId: agent.agentId, account: agent.account, role: "repairer", shareYocto: amount },
        ],
        amountYocto: amount,
        estimatedDurationMs: limits.callMs,
        planHash: digestOf(settings.BENCH_OPERATOR_STYLE),
        ...(strategy === undefined ? {} : { strategy }),
      },
      agent,
    );
    const reply = await client.post(`${path}/bids`, { bid });
    return {
      status: reply.status,
      code:
        z.object({ error: z.object({ code: z.string() }) }).safeParse(reply.body).data?.error
          .code ?? null,
    };
  }
  const brief = repairBriefSchema.parse(ok(await client.get(`${path}/repair`)));
  const last = task.checkpoints.at(-1);
  const original =
    last === undefined
      ? brief.source
      : z
          .object({ source: z.string() })
          .parse(ok(await client.get(`${path}/artifacts/${last.checkpoint.contentHash}`))).source;
  if (last !== undefined && digestText(original) !== last.checkpoint.contentHash)
    throw new Error("Checkpoint content does not match its hash");
  const generate = async () => {
    if (model === null) throw new Error("Missing operator model");
    const started = performance.now();
    const diagnosis =
      settings.BENCH_OPERATOR_HARDENED === "1" ? publicDiagnosis(original, brief) : null;
    const promptBrief = {
      objective: `${task.manifest.objective} ${settings.BENCH_OPERATOR_STYLE}`,
      rules: brief.rules,
      brokenSource: original,
      resumedFrom: last?.checkpoint.contentHash ?? null,
      suite: brief.suite,
      generic: true,
      validatedSubtasks: [],
      diagnosis,
      ...(settings.BENCH_OPERATOR_HARDENED === "1" && strategy !== undefined
        ? {
            recoveryStrategy:
              recoveryStrategyFor(original, task.recoveryFeedback ?? [], strategy) ?? strategy,
          }
        : {}),
      failureHistory: [
        ...task.failures.map(({ reason }) => reason),
        ...(task.manifest.policy.recoveryStrategy === undefined &&
        settings.BENCH_OPERATOR_HARDENED !== "1"
          ? []
          : repairFeedback(
              original,
              brief,
              task.recoveryFeedback ?? [],
              diagnosis?.finding.failingCases,
            )),
        ...rebuildInstruction(strategy),
      ],
    };
    let packed: ReturnType<typeof budgetedRepairPrompt> | null;
    try {
      packed =
        settings.BENCH_OPERATOR_BOUNDED === "1"
          ? budgetedRepairPrompt(promptBrief, limits.maxPromptBytes)
          : null;
    } catch (error) {
      if (!(error instanceof PromptBudgetError)) throw error;
      return {
        source: null,
        status: "prompt-too-large",
        promptTokens: null,
        outputTokens: null,
        promptBytes: error.promptBytes,
        elapsedMs: Math.round(performance.now() - started),
      };
    }
    const result = await infer(
      model,
      packed?.messages ?? repairPrompt(promptBrief),
      performance.now() + Math.max(0, task.manifest.deadlineMs - Date.now()),
    );
    return {
      ...result,
      elapsedMs: Math.round(performance.now() - started),
      ...(packed === null
        ? {}
        : { promptCompaction: packed.compaction, promptStrategy: packed.strategy }),
    };
  };
  if (action === "infer") return generate();
  const claim = z
    .object({
      events: z.array(z.object({ body: z.object({ lease: z.object({ fencingToken: z.int() }) }) })),
    })
    .parse(ok(await client.post(`${path}/claim`, {})));
  const fencingToken = claim.events[0]?.body.lease.fencingToken;
  if (fencingToken === undefined) throw new Error("The coordinator returned no lease");
  const heartbeat = setInterval(
    () => {
      void client.post(`${path}/heartbeat`, { fencingToken }).catch((error: unknown) => {
        process.stderr.write(String(error) + "\n");
      });
    },
    Math.floor(task.manifest.policy.leaseMs / 3),
  );
  try {
    const inference = source === undefined ? await generate() : null;
    const patch = source === undefined ? (inference?.source ?? null) : source;
    if (patch === null) {
      const reason =
        failureReason ??
        (inference?.status === "provider-timeout"
          ? "PROVIDER_TIMEOUT"
          : inference?.status === "prompt-too-large"
            ? "PROMPT_LIMIT"
            : inference?.status === "invalid-or-truncated-code"
              ? "INVALID_OUTPUT"
              : undefined);
      if (settings.BENCH_OPERATOR_BOUNDED === "1" && reason !== undefined)
        ok(await client.post(`${path}/failures`, { fencingToken, reason }));
      return { inference, status: "no-patch" };
    }
    const checkpoint = {
      taskId,
      attempt: task.attempt,
      stateVersion: task.version,
      contentHash: digestText(patch),
      artifactUri: "benchmark://signed-operator",
      validatedSubtasks: [],
      provenanceEventIds: [`${taskId}#${String(task.version)}`],
      parentCheckpointHash: last?.hash ?? null,
    };
    ok(await client.post(`${path}/checkpoints`, { fencingToken, checkpoint, source: patch }));
    if (submit === false) return { inference, status: "checkpointed" };
    const current = snapshot.parse(ok(await client.get(path))).task;
    const checkpointHash = current.checkpoints.at(-1)?.hash;
    if (checkpointHash === undefined) throw new Error("The coordinator lost the checkpoint");
    ok(await client.post(`${path}/artifacts`, { fencingToken, source: patch, checkpointHash }));
    return { inference, status: "submitted" };
  } finally {
    clearInterval(heartbeat);
  }
}

process.on("message", (raw: Json) => {
  const value = request.parse(raw);
  void act(value).then(
    (value) => process.send?.({ value }),
    (error: unknown) =>
      process.send?.({ error: error instanceof Error ? error.message : String(error) }),
  );
});
process.send({
  ready: true,
  agentId: agent.agentId,
  host: new URL(model.baseUrl).hostname,
  model: model.model,
});
