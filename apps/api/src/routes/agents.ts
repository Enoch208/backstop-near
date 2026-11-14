import {
  agentIdSchema,
  hexSchema,
  nearAccountSchema,
  signatureSchema,
  verifyValue,
} from "@backstop/shared";
import { roster } from "@backstop/agents";
import { z } from "zod";
import { errorResponse, failure, json, readJson } from "../http.js";
import { atomic, type Runtime } from "../runtime.js";

export const openRoles = ["challenger", "repairer", "diagnostician"] as const;

const registrationSchema = z.strictObject({
  claim: z.strictObject({
    agentId: agentIdSchema,
    account: nearAccountSchema,
    role: z.enum(openRoles),
    publicKey: hexSchema.length(64),
  }),
  proof: signatureSchema,
});

export async function register(runtime: Runtime, request: Request): Promise<Response> {
  const traceId = crypto.randomUUID();
  const parsed = registrationSchema.safeParse(await readJson(request));
  if (!parsed.success)
    return errorResponse(failure("INVALID_SCHEMA", parsed.error.message), traceId, null);
  const { claim, proof } = parsed.data;
  if (proof.publicKey !== claim.publicKey || !verifyValue(claim, proof)) {
    return errorResponse(
      failure("BAD_SIGNATURE", "The proof is not signed by the key being registered"),
      traceId,
      null,
    );
  }
  if (
    ["keeper", "near-indexer", "fixture-vault"].includes(claim.agentId) ||
    claim.agentId === roster.verifier.agentId
  ) {
    return errorResponse(
      failure("UNAUTHORIZED", "This identity belongs to the coordinator service"),
      traceId,
      null,
    );
  }
  const existing = runtime.identities.get(claim.agentId);
  if (existing !== undefined) {
    return existing.publicKey === claim.publicKey && existing.account === claim.account
      ? json({ registered: claim.agentId, alreadyKnown: true })
      : errorResponse(
          failure("DUPLICATE", `${claim.agentId} is already registered with different credentials`),
          traceId,
          null,
        );
  }
  if ([...runtime.identities.values()].some((identity) => identity.account === claim.account)) {
    return errorResponse(
      failure("DUPLICATE", "This payout account is already assigned to another identity"),
      traceId,
      null,
    );
  }
  atomic(runtime, () => {
    runtime.identities.set(claim.agentId, {
      id: claim.agentId,
      account: claim.account,
      publicKey: claim.publicKey,
    });
    runtime.registry = {
      ...runtime.registry,
      agentKeys: { ...runtime.registry.agentKeys, [claim.agentId]: claim.publicKey },
    };
  });
  return json({ registered: claim.agentId, role: claim.role }, 201);
}

export function listTasks(runtime: Runtime): Response {
  return json({
    tasks: Object.values(runtime.store.records).map((record) => ({
      taskId: record.taskId,
      state: record.state,
      version: record.version,
      attempt: record.attempt,
      objective: record.manifest.objective,
    })),
  });
}
