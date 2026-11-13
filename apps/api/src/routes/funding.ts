import {
  fromYocto,
  leadAgent,
  signedBidSchema,
  taskManifestSchema,
  yoctoSchema,
} from "@backstop/shared";
import { z } from "zod";
import { signedWrite } from "../auth.js";
import { failure } from "../http.js";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const createBody = z.strictObject({ manifest: taskManifestSchema });
const fundBody = z.strictObject({
  pool: z.enum(["escrow", "premium", "bond"]),
  amountYocto: yoctoSchema,
  liabilityYocto: yoctoSchema.nullable(),
});
const bidBody = z.strictObject({ bid: signedBidSchema });

export function createTask(runtime: Runtime, request: Request): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(createBody, body);
    if (!parsed.ok) return { error: parsed.error, taskVersion: null };
    const { manifest } = parsed.value;
    if (manifest.owner !== actor.account) {
      return refuse(
        runtime,
        manifest.taskId,
        failure("UNAUTHORIZED", "Only the manifest owner creates the task"),
      );
    }
    return fromOutcome(
      runtime,
      manifest.taskId,
      execute(runtime, manifest.taskId, actor.id, { kind: "create", manifest }),
      201,
    );
  });
}

export function fund(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(fundBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const record = runtime.store.records[taskId];
    if (record === undefined)
      return refuse(runtime, taskId, failure("NOT_FOUND", `No task ${taskId}`));
    const amount = fromYocto(parsed.value.amountYocto);
    const reference = `fixture-vault:${actor.id}:${parsed.value.pool}`;
    if (parsed.value.pool === "bond") {
      const liability =
        parsed.value.liabilityYocto === null ? amount : fromYocto(parsed.value.liabilityYocto);
      return fromOutcome(
        runtime,
        taskId,
        execute(runtime, taskId, actor.id, {
          kind: "postGuarantee",
          guarantor: actor.account,
          bond: amount,
          liability,
          reference,
        }),
      );
    }
    if (actor.account !== record.manifest.owner) {
      return refuse(
        runtime,
        taskId,
        failure("UNAUTHORIZED", "Only the customer funds escrow and premium"),
      );
    }
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "deposit",
        pool: parsed.value.pool,
        amount,
        reference,
      }),
    );
  });
}

export function bid(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(bidBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const signed = parsed.value.bid;
    if (leadAgent(signed.bid) !== actor.id) {
      return refuse(
        runtime,
        taskId,
        failure("UNAUTHORIZED", "A bid is submitted by its lead agent"),
      );
    }
    const state = runtime.store.records[taskId]?.state;
    if (signed.bid.epoch === 0 && (state === "FUNDED" || state === "BONDED")) {
      return fromOutcome(
        runtime,
        taskId,
        execute(runtime, taskId, "coordinator", { kind: "assignPrimary", bid: signed }),
      );
    }
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, { kind: "bid", bid: signed }),
    );
  });
}
