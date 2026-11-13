import { checkpointSchema, digestSchema, digestText } from "@backstop/shared";
import { z } from "zod";
import { signedWrite } from "../auth.js";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const token = z.int().min(1);
const claimBody = z.strictObject({});
const heartbeatBody = z.strictObject({ fencingToken: token });
const checkpointBody = z.strictObject({ fencingToken: token, checkpoint: checkpointSchema });
const artifactBody = z.strictObject({
  fencingToken: token,
  source: z.string().min(1).max(64_000),
  checkpointHash: digestSchema.nullable(),
});

export function claim(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(claimBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, { kind: "claim", agentId: actor.id }),
    );
  });
}

export function heartbeat(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(heartbeatBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "heartbeat",
        agentId: actor.id,
        fencingToken: parsed.value.fencingToken,
      }),
    );
  });
}

export function checkpoint(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(checkpointBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "checkpoint",
        agentId: actor.id,
        fencingToken: parsed.value.fencingToken,
        checkpoint: parsed.value.checkpoint,
      }),
    );
  });
}

export function submitArtifact(
  runtime: Runtime,
  request: Request,
  taskId: string,
): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(artifactBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const artifactHash = digestText(parsed.value.source);
    runtime.artifacts.set(artifactHash, parsed.value.source);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "submit",
        agentId: actor.id,
        fencingToken: parsed.value.fencingToken,
        artifactHash,
        checkpointHash: parsed.value.checkpointHash,
      }),
      201,
    );
  });
}
