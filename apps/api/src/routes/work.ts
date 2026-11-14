import { extractSource } from "@backstop/agents";
import { checkpointSchema, digestSchema, digestText, workerFailureReasons } from "@backstop/shared";
import { checkReceipt, inferenceReceiptSchema, type InferenceReceipt } from "@backstop/tee";
import { z } from "zod";
import { signedWrite } from "../auth.js";
import { failure, type ApiError } from "../http.js";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const token = z.int().min(1);
const claimBody = z.strictObject({});
const heartbeatBody = z.strictObject({ fencingToken: token });
const failureBody = z.strictObject({ fencingToken: token, reason: z.enum(workerFailureReasons) });
const checkpointBody = z.strictObject({
  fencingToken: token,
  checkpoint: checkpointSchema,
  source: z.string().min(1).max(64_000).optional(),
});
const artifactBody = z.strictObject({
  fencingToken: token,
  source: z.string().min(1).max(64_000),
  checkpointHash: digestSchema.nullable(),
  inference: inferenceReceiptSchema.optional(),
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

export function reportFailure(
  runtime: Runtime,
  request: Request,
  taskId: string,
): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(failureBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "reportFailure",
        agentId: actor.id,
        ...parsed.value,
      }),
    );
  });
}

export function checkpoint(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(checkpointBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const source = parsed.value.source;
    if (source !== undefined) {
      if (digestText(source) !== parsed.value.checkpoint.contentHash)
        return refuse(
          runtime,
          taskId,
          failure("POLICY_VIOLATION", "The checkpoint source does not hash to its contentHash"),
        );
      runtime.artifacts.set(parsed.value.checkpoint.contentHash, source);
    }
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

function attest(runtime: Runtime, receipt: InferenceReceipt, source: string): ApiError | null {
  const check = checkReceipt(receipt, runtime.teeSigners);
  if (!check.ok) return failure("POLICY_VIOLATION", `Inference receipt refused: ${check.reason}`);
  if (extractSource(check.content) !== source)
    return failure(
      "POLICY_VIOLATION",
      "Inference receipt refused: the signed reply holds other code",
    );
  runtime.inferences.set(digestText(source), check.inference);
  return null;
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
    const receipt = parsed.value.inference;
    if (receipt !== undefined) {
      const refusal = attest(runtime, receipt, parsed.value.source);
      if (refusal !== null) return refuse(runtime, taskId, refusal);
    }
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
