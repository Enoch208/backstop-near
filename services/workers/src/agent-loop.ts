import {
  decideToJoin,
  endorsement,
  priceRecovery,
  pricedBid,
  primaryBid,
  recoveryTeam,
  searchCounterexample,
  type Diagnosis,
  type FixtureAgent,
  type ModelConfig,
  type PricingProfile,
} from "@backstop/agents";
import { candidate, checkoutSuite } from "@backstop/fixture-checkout";
import {
  canonicalJson,
  digestText,
  formatNear,
  fromYocto,
  leadAgent,
  minYocto,
  pendingEndorsers,
  repairBriefSchema,
  type Digest,
  type RepairTaskBrief,
  type SignedBid,
} from "@backstop/shared";
import type { ApiClient } from "./client.js";
import { diagnose, fetchFinding, findingBoard, probeRepair } from "./diagnosis.js";
import { produce, publicFailures, type Resume } from "./produce.js";
import { reserveStandby, type StandbyTerms } from "./standby.js";
import { rebuildInstruction, repairFeedback } from "./recovery-feedback.js";
import {
  artifactReplySchema,
  leaseReplySchema,
  snapshotSchema,
  workerEventSchema,
  type Snapshot,
} from "./messages.js";

export type Log = (line: string) => void;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function agentLoop(
  agent: FixtureAgent,
  client: ApiClient,
  taskId: string,
  log: Log,
  onDone: () => void,
  model: ModelConfig | null = null,
  externalProfile?: PricingProfile,
  currency = "NEAR",
  standby?: StandbyTerms,
  strategy?: StandbyTerms["strategy"],
) {
  const base = `/api/tasks/${taskId}`;
  const bidEpochs = new Set<number>();
  const history: string[] = [];
  const board = findingBoard();
  let repairBrief: RepairTaskBrief | undefined;
  let reservations: Promise<void> | undefined;

  const snapshot = async (): Promise<Snapshot> =>
    snapshotSchema.parse((await client.get(base)).body).task;

  const repairTaskFor = async (task: Snapshot): Promise<RepairTaskBrief | undefined> => {
    if (task.manifest.repairTaskHash === undefined) return undefined;
    repairBrief ??= repairBriefSchema.parse((await client.get(`${base}/repair`)).body);
    return repairBrief;
  };

  const startingSource = (repairTask?: RepairTaskBrief) =>
    repairTask?.source ?? candidate("original").source;

  const bidPrimary = async () => {
    const signed = primaryBid(agent, taskId, "0.30", Date.now());
    const reply = await client.post(`${base}/bids`, { bid: signed });
    log(`offered to be the primary for 0.30 ${currency} (HTTP ${String(reply.status)})`);
  };

  const bidRecovery = async (epoch: number) => {
    const offer =
      externalProfile === undefined
        ? recoveryTeam(agent.agentId)
        : {
            team: [{ agent, profile: externalProfile }],
            plan: "Repair and verify the pinned checkpoint",
          };
    if (offer === null || (externalProfile !== undefined && agent.role !== "repairer")) return;
    const task = await snapshot();
    const repairTask = await repairTaskFor(task);
    if (
      (externalProfile !== undefined && repairTask === undefined) ||
      (repairTask !== undefined && model === null)
    )
      return;
    const failed = offer.team.find((member) => task.excludedAgents.includes(member.agent.agentId));
    if (failed !== undefined) {
      log(`sits out epoch ${String(epoch)}: ${failed.agent.agentId} already failed this task`);
      return;
    }
    const resume = await resumeFrom(task);
    const check = publicFailures(resume?.source ?? startingSource(repairTask), repairTask);
    const { ledger } = task;
    const liability = fromYocto(ledger.maxBondLiability) - fromYocto(ledger.bondConsumed);
    const quote = priceRecovery(offer.team, {
      budgetYocto:
        fromYocto(ledger.available.escrow) + minYocto(liability, fromYocto(ledger.available.bond)),
      epoch,
      failures: task.failures.map((failure) => failure.reason),
      failingCases: check.failures.length,
      publicCases: check.passed.length + check.failures.length,
      msLeft: task.manifest.deadlineMs - Date.now(),
      currency,
    });
    for (const line of quote.reasoning) log(`pricing: ${line}`);
    if (quote.kind === "decline") return;
    const mine = pricedBid(
      { taskId, epoch, nowMs: Date.now(), bidWindowMs: task.manifest.policy.bidWindowMs },
      repairTask === undefined || externalProfile !== undefined
        ? offer.plan
        : `Repair the checkpoint for ${repairTask.suite.entry} with ${offer.team.map(({ agent }) => agent.role).join(" and ")}`,
      quote,
      strategy,
    );
    const reply = await client.post(`${base}/bids`, { bid: mine });
    const kind = pendingEndorsers(mine).length > 0 ? "proposed a coalition at" : "bid";
    log(
      `${kind} ${formatNear(fromYocto(mine.bid.amountYocto))} ${currency} for epoch ${String(epoch)} (HTTP ${String(reply.status)})`,
    );
  };

  const join = async (signed: SignedBid) => {
    const task = await snapshot();
    const decision = decideToJoin(agent, signed, task.excludedAgents);
    if (!decision.join) {
      log(`declined ${leadAgent(signed.bid)}'s coalition: ${decision.reason}`);
      return;
    }
    const { signature } = endorsement(signed, agent);
    const reply = await client.post(`${base}/endorsements`, { bidHash: signed.bidHash, signature });
    log(
      `co-signed ${leadAgent(signed.bid)}'s coalition: ${decision.reason} (HTTP ${String(reply.status)})`,
    );
  };

  const resumeFrom = async (task: Snapshot): Promise<Resume | null> => {
    const latest = task.checkpoints.at(-1)?.checkpoint;
    if (latest === undefined) return null;
    const reply = await client.get(`${base}/artifacts/${latest.contentHash}`);
    const fetched = artifactReplySchema.safeParse(reply.body);
    if (!fetched.success || digestText(fetched.data.source) !== latest.contentHash) {
      log(
        `checkpoint ${latest.contentHash.slice(0, 19)}… is unavailable or altered; starting fresh`,
      );
      return null;
    }
    return { source: fetched.data.source, hash: latest.contentHash };
  };

  const diagnoseAttempt = async (attempt: number) => {
    const task = await snapshot();
    const repairTask = await repairTaskFor(task);
    const source = startingSource(repairTask);
    const code = (await resumeFrom(task)) ?? { source, hash: digestText(source) };
    const finding = diagnose(taskId, attempt, agent.agentId, code, repairTask);
    const reply = await client.post(`${base}/findings`, { attempt, finding });
    const cases = finding.failingCases.map((failing) => failing.id).join(", ") || "none";
    log(
      `posted a finding on ${code.hash.slice(0, 19)}… for attempt ${String(attempt)}, failing cases: ${cases} (HTTP ${String(reply.status)})`,
    );
  };

  const awaitDiagnosis = async (
    attempt: number,
    assigned: SignedBid,
    leaseMs: number,
  ): Promise<Diagnosis | null> => {
    const partners = assigned.bid.members
      .filter((member) => member.agentId !== agent.agentId && member.role === "diagnostician")
      .map((member) => member.agentId);
    if (partners.length === 0) return null;
    const posted = await board.next(attempt, partners, Math.min(3_000, Math.floor(leaseMs / 2)));
    if (posted === null) {
      log(`no finding from ${partners.join(", ")} in time; repairing without one`);
      return null;
    }
    const diagnosis = await fetchFinding(client, base, posted);
    if (diagnosis === null) {
      log(`${posted.agentId}'s finding is unavailable or altered; repairing without it`);
      return null;
    }
    const cases = diagnosis.finding.failingCases.map((failing) => failing.id).join(", ");
    log(
      `consumed ${posted.agentId}'s finding ${posted.findingHash.slice(0, 19)}… (hash verified), failing cases: ${cases || "none"}`,
    );
    return diagnosis;
  };

  const work = async (assigned: SignedBid) => {
    const claim = leaseReplySchema.safeParse((await client.post(`${base}/claim`, {})).body);
    const token = claim.success
      ? claim.data.events.find((event) => event.body.lease)?.body.lease?.fencingToken
      : undefined;
    if (token === undefined) {
      log("could not claim the lease");
      return;
    }
    const task = await snapshot();
    const repairTask = await repairTaskFor(task);
    log(`claimed attempt ${String(task.attempt)} with fencing token ${String(token)}`);
    const beat = setInterval(
      () => {
        void client.post(`${base}/heartbeat`, { fencingToken: token });
      },
      Math.floor(task.manifest.policy.leaseMs / 3),
    );
    const step = Math.floor(task.manifest.policy.leaseMs / 4);
    const inherited = task.checkpoints.at(-1)?.checkpoint.validatedSubtasks ?? [];
    const resume = await resumeFrom(task);
    if (resume !== null)
      log(
        `resumed from checkpoint ${resume.hash.slice(0, 19)}… (hash verified), which passes ${inherited.join(", ") || "nothing yet"}`,
      );
    const diagnosis = await awaitDiagnosis(task.attempt, assigned, task.manifest.policy.leaseMs);
    const product = await produce(agent, model, {
      objective: task.manifest.objective,
      inherited,
      history: [
        ...history,
        ...(repairTask === undefined || resume === null
          ? []
          : repairFeedback(resume.source, repairTask, task.recoveryFeedback ?? [])),
        ...rebuildInstruction(assigned.bid.strategy),
      ],
      resume,
      diagnosis,
      ...(repairTask === undefined ? {} : { repairTask }),
    }).catch((error: unknown) => {
      clearInterval(beat);
      log("stopped heartbeats so the lease expires and the work is re-auctioned");
      throw error;
    });
    await wait(step);
    const parent = (await snapshot()).checkpoints.at(-1)?.hash ?? null;
    const checkpoint = {
      taskId,
      attempt: task.attempt,
      stateVersion: task.version,
      contentHash: product.artifactHash,
      artifactUri: product.uri,
      validatedSubtasks: [...product.validatedSubtasks],
      provenanceEventIds: [`${taskId}#${String(task.version)}`],
      parentCheckpointHash: parent,
    };
    const checkpointReply = await client.post(`${base}/checkpoints`, {
      fencingToken: token,
      checkpoint,
      source: product.source,
    });
    if (checkpointReply.status < 200 || checkpointReply.status >= 300) {
      clearInterval(beat);
      throw new Error(`Checkpoint refused (HTTP ${String(checkpointReply.status)})`);
    }
    log(`checkpointed ${product.validatedSubtasks.join(", ") || "no validated subtasks"}`);
    if (!product.completes) {
      log("still working; heartbeats continue until the process ends");
      return;
    }
    await wait(step);
    const latest = (await snapshot()).checkpoints.at(-1)?.hash ?? null;
    if (product.unsigned !== null) log(product.unsigned);
    const reply = await client.post(`${base}/artifacts`, {
      fencingToken: token,
      source: product.source,
      checkpointHash: latest,
      ...(product.inference === null ? {} : { inference: product.inference }),
    });
    clearInterval(beat);
    log(`submitted ${product.label} (HTTP ${String(reply.status)})`);
  };

  const challenge = async (attempt: number, artifactHash: Digest) => {
    const fetched = artifactReplySchema.parse(
      (await client.get(`${base}/artifacts/${artifactHash}`)).body,
    );
    const repairTask = await repairTaskFor(await snapshot());
    if (repairTask !== undefined) {
      const probe = probeRepair(fetched.source, repairTask);
      if (probe === null) {
        log(
          `checked ${String(repairTask.probes.length)} pinned challenge probes, no counterexample`,
        );
        return;
      }
      const reply = await client.post(`${base}/challenge`, { input: probe.input });
      log(`challenged with ${probe.id} (HTTP ${String(reply.status)})`);
      return;
    }
    const target = {
      taskId,
      attempt,
      artifactHash,
      artifactSource: fetched.source,
      suite: checkoutSuite,
    };
    const search = searchCounterexample(target, agent.agentId, 7);
    if (search.input === null) {
      log(`probed ${String(search.probes)} inputs, no counterexample`);
      return;
    }
    const reply = await client.post(`${base}/challenge`, { input: search.input });
    log(`challenged after ${String(search.probes)} probes (HTTP ${String(reply.status)})`);
  };

  const run = (task: Promise<unknown>) => {
    task.catch((error: unknown) => {
      log(`error: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  return (raw: unknown) => {
    const parsed = workerEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const body = parsed.data.body;
    if (body.type === "guarantee_posted" && agent.role === "executor") run(bidPrimary());
    if (body.type === "guarantee_posted" && standby !== undefined) {
      reservations = snapshot().then(async (task) => {
        if (
          task.manifest.repairTaskHash === undefined ||
          task.excludedAgents.includes(agent.agentId) ||
          task.assignment?.bid.bid.members.some(({ agentId }) => agentId === agent.agentId) ===
            true ||
          !["BONDED", "ASSIGNED", "EXECUTING", "RECOVERY_ASSIGNED", "RECOVERY_OPEN"].includes(
            task.state,
          )
        )
          return;
        await reserveStandby(client, agent, task, standby);
        log(`reserved standby capacity at ${formatNear(standby.amount)} ${currency}`);
      });
      run(reservations);
    }
    if (body.type === "recovery_opened" && !bidEpochs.has(body.epoch)) {
      bidEpochs.add(body.epoch);
      if (standby === undefined) run(bidRecovery(body.epoch));
      else
        run(
          (async () => {
            await reservations;
            const task = await snapshot();
            if (task.state !== "RECOVERY_OPEN" || task.excludedAgents.includes(agent.agentId))
              return;
            const reply = await client.post(`${base}/standby/ready`, { epoch: body.epoch });
            log(
              `standby availability for epoch ${String(body.epoch)} (HTTP ${String(reply.status)})`,
            );
          })(),
        );
    }
    if (body.type === "coalition_proposed" && pendingEndorsers(body.bid).includes(agent.agentId)) {
      run(join(body.bid));
    }
    if (body.type === "attempt_assigned") {
      const seat = body.bid.bid.members.find((member) => member.agentId === agent.agentId);
      if (leadAgent(body.bid.bid) === agent.agentId) run(work(body.bid));
      else if (seat?.role === "diagnostician") run(diagnoseAttempt(body.attempt));
    }
    if (body.type === "finding_recorded") board.record(body);
    const accepted =
      body.type === "verification_recorded" && body.evidence.body.verdict === "ACCEPT";
    if (accepted && agent.role === "challenger") {
      run(challenge(body.evidence.body.attempt, body.evidence.body.artifactHash));
    }
    if (body.type === "attempt_failed")
      history.push(`attempt ${String(body.attempt)} failed: ${body.reason}`);
    if (body.type === "attempt_rejected") {
      const ruling = body.ruling;
      history.push(
        ruling === null
          ? `attempt ${String(body.attempt)} was rejected by the verifier`
          : `a challenger showed attempt ${String(body.attempt)} returned ${canonicalJson(ruling.actual)} where the specification requires ${canonicalJson(ruling.expected)}`,
      );
    }
    if (body.type === "task_settled") onDone();
  };
}
