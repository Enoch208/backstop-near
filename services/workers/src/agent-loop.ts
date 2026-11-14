import {
  decideToJoin,
  endorsement,
  fixtureBids,
  primaryBid,
  searchCounterexample,
  type Diagnosis,
  type FixtureAgent,
  type ModelConfig,
} from "@backstop/agents";
import { candidate, checkoutSuite } from "@backstop/fixture-checkout";
import {
  canonicalJson,
  digestText,
  formatNear,
  fromYocto,
  leadAgent,
  pendingEndorsers,
  type Digest,
  type SignedBid,
} from "@backstop/shared";
import type { ApiClient } from "./client.js";
import { diagnose, fetchFinding, findingBoard } from "./diagnosis.js";
import { produce, type Resume } from "./produce.js";
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
) {
  const base = `/api/tasks/${taskId}`;
  const bidEpochs = new Set<number>();
  const history: string[] = [];
  const board = findingBoard();

  const snapshot = async (): Promise<Snapshot> =>
    snapshotSchema.parse((await client.get(base)).body).task;

  const bidPrimary = async () => {
    const signed = primaryBid(agent, taskId, "0.30", Date.now());
    const reply = await client.post(`${base}/bids`, { bid: signed });
    log(`offered to be the primary for 0.30 NEAR (HTTP ${String(reply.status)})`);
  };

  const bidRecovery = async (epoch: number) => {
    const task = await snapshot();
    const [mine] = fixtureBids({
      taskId,
      epoch,
      nowMs: Date.now(),
      bidWindowMs: task.manifest.policy.bidWindowMs,
      excludedAgents: task.excludedAgents,
    }).filter((signed) => leadAgent(signed.bid) === agent.agentId);
    if (mine === undefined) return;
    const reply = await client.post(`${base}/bids`, { bid: mine });
    const kind = pendingEndorsers(mine).length > 0 ? "proposed a coalition at" : "bid";
    log(
      `${kind} ${formatNear(fromYocto(mine.bid.amountYocto))} NEAR for epoch ${String(epoch)} (HTTP ${String(reply.status)})`,
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
    const original = candidate("original");
    const code = (await resumeFrom(await snapshot())) ?? {
      source: original.source,
      hash: original.artifactHash,
    };
    const finding = diagnose(taskId, attempt, agent.agentId, code);
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
      history,
      resume,
      diagnosis,
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
    await client.post(`${base}/checkpoints`, {
      fencingToken: token,
      checkpoint,
      source: product.source,
    });
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
    if (body.type === "recovery_opened" && !bidEpochs.has(body.epoch)) {
      bidEpochs.add(body.epoch);
      run(bidRecovery(body.epoch));
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
