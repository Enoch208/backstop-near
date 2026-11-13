import type { Outcome } from "@backstop/shared";
import type { TaskEvent } from "@backstop/orchestrator";
import type { z } from "zod";
import type { Handled } from "../auth.js";
import { failure, type ApiError } from "../http.js";
import type { Runtime } from "../runtime.js";

export type Result = Handled | { error: ApiError; taskVersion: number | null };

export function versionOf(runtime: Runtime, taskId: string): number | null {
  return runtime.store.records[taskId]?.version ?? null;
}

export function fromOutcome(
  runtime: Runtime,
  taskId: string,
  outcome: Outcome<TaskEvent[]>,
  status = 200,
): Result {
  if (!outcome.ok) {
    return {
      error: failure(outcome.failure.code, outcome.failure.message),
      taskVersion: versionOf(runtime, taskId),
    };
  }
  return { status, value: { version: versionOf(runtime, taskId), events: outcome.value } };
}

export function refuse(runtime: Runtime, taskId: string, error: ApiError): Result {
  return { error, taskVersion: versionOf(runtime, taskId) };
}

export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { ok: true; value: T } | { ok: false; error: ApiError } {
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: failure("INVALID_SCHEMA", parsed.error.message) };
}
