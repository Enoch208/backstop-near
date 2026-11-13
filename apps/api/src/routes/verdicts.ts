import { roster } from "@backstop/agents";
import { checkoutSuite } from "@backstop/fixture-checkout";
import { attestRuling, judgeChallenge } from "@backstop/verifier";
import { z } from "zod";
import { signedWrite } from "../auth.js";
import { failure } from "../http.js";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const challengeBody = z.strictObject({ input: z.json() });
const settleBody = z.strictObject({});

export function challenge(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(challengeBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const record = runtime.store.records[taskId];
    const candidate = record?.candidate ?? null;
    if (record === undefined || candidate === null) {
      return refuse(runtime, taskId, failure("NOT_FOUND", "There is no artifact to challenge"));
    }
    if (record.assignment?.bid.bid.members.some((member) => member.agentId === actor.id) === true) {
      return refuse(
        runtime,
        taskId,
        failure("POLICY_VIOLATION", "An agent cannot challenge its own work"),
      );
    }
    const source = runtime.artifacts.get(candidate.artifactHash);
    if (source === undefined)
      return refuse(runtime, taskId, failure("NOT_FOUND", "The artifact is not stored"));
    const ruling = judgeChallenge({
      taskId,
      attempt: candidate.attempt,
      artifactHash: candidate.artifactHash,
      artifactSource: source,
      suite: checkoutSuite,
      input: parsed.value.input,
      challenger: actor.id,
    });
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "challenge",
        signed: attestRuling(ruling, roster.verifier.key),
      }),
    );
  });
}

export function settle(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(settleBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const record = runtime.store.records[taskId];
    if (record === undefined)
      return refuse(runtime, taskId, failure("NOT_FOUND", `No task ${taskId}`));
    if (actor.id !== "coordinator" && actor.account !== record.manifest.owner) {
      return refuse(
        runtime,
        taskId,
        failure("UNAUTHORIZED", "Only the coordinator or the customer settles"),
      );
    }
    const kind = record.state === "TERMINAL_FAILURE" ? "settleFailure" : "settle";
    return fromOutcome(runtime, taskId, execute(runtime, taskId, actor.id, { kind }));
  });
}
