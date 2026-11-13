import { z } from "zod";
import { signedWrite } from "../auth.js";
import { errorResponse, failure, type ApiError } from "../http.js";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const faultBody = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("kill_worker"), taskId: z.string(), agentId: z.string() }),
  z.strictObject({ action: z.literal("fail_next_transfer"), taskId: z.string() }),
  z.strictObject({ action: z.literal("repeat_settlement"), taskId: z.string() }),
]);

const disabled: ApiError = {
  code: "DEMO_DISABLED",
  message: "Fault injection is only available when the API runs in demo mode",
  status: 403,
  retryable: false,
};

export function fault(runtime: Runtime, request: Request): Promise<Response> {
  if (!runtime.demo) return Promise.resolve(errorResponse(disabled, crypto.randomUUID(), null));
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(faultBody, body);
    if (!parsed.ok) return { error: parsed.error, taskVersion: null };
    const order = parsed.value;
    if (actor.id !== "coordinator") {
      return refuse(
        runtime,
        order.taskId,
        failure("UNAUTHORIZED", "Only the coordinator injects faults"),
      );
    }
    if (order.action === "kill_worker") {
      const killed = runtime.workers?.kill(order.taskId, order.agentId) ?? false;
      if (!killed)
        return refuse(
          runtime,
          order.taskId,
          failure("NOT_FOUND", `No live worker ${order.agentId}`),
        );
      return {
        status: 202,
        value: { action: order.action, agentId: order.agentId, signal: "SIGKILL" },
      };
    }
    if (order.action === "fail_next_transfer") {
      runtime.faults.failNextTransfer = true;
      return { status: 202, value: { action: order.action } };
    }
    return fromOutcome(
      runtime,
      order.taskId,
      execute(runtime, order.taskId, actor.id, { kind: "settle" }),
    );
  });
}
