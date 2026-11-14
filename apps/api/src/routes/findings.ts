import { digestSchema, findingHash, findingSchema } from "@backstop/shared";
import { z } from "zod";
import { signedWrite } from "../auth.js";
import { errorResponse, failure, json } from "../http.js";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const findingBody = z.strictObject({ attempt: z.int().min(1), finding: findingSchema });

export function postFinding(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(findingBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const finding = parsed.value.finding;
    const hash = findingHash(finding);
    const outcome = execute(runtime, taskId, actor.id, {
      kind: "recordFinding",
      agentId: actor.id,
      attempt: parsed.value.attempt,
      findingHash: hash,
      failingCases: finding.failingCases.map((failing) => failing.id),
    });
    if (outcome.ok) runtime.findings.set(hash, finding);
    return fromOutcome(runtime, taskId, outcome, 201);
  });
}

export function getFinding(runtime: Runtime, hash: string): Response {
  const parsed = digestSchema.safeParse(hash);
  const finding = parsed.success ? runtime.findings.get(parsed.data) : undefined;
  if (finding === undefined)
    return errorResponse(failure("NOT_FOUND", `No finding ${hash}`), crypto.randomUUID(), null);
  return json({ findingHash: hash, finding });
}
