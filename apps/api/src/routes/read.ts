import { quote, statement } from "@backstop/ledger";
import type { TaskEvent } from "@backstop/orchestrator";
import { digestSchema } from "@backstop/shared";
import { errorResponse, failure, json, toJson } from "../http.js";
import type { Runtime } from "../runtime.js";

const notFound = (what: string) =>
  errorResponse(failure("NOT_FOUND", what), crypto.randomUUID(), null);

export function health(runtime: Runtime): Response {
  return json({
    ok: true,
    mode: runtime.mode,
    demo: runtime.demo,
    tasks: Object.keys(runtime.store.records).length,
  });
}

export function getTask(runtime: Runtime, taskId: string): Response {
  const record = runtime.store.records[taskId];
  if (record === undefined) return notFound(`No task ${taskId}`);
  return json({
    mode: runtime.mode,
    task: record,
    statement: statement(record.ledger),
    quote: quote(record.manifest),
  });
}

export function getArtifact(runtime: Runtime, hash: string): Response {
  const parsed = digestSchema.safeParse(hash);
  const source = parsed.success ? runtime.artifacts.get(parsed.data) : undefined;
  if (source === undefined) return notFound(`No artifact ${hash}`);
  return json({ artifactHash: hash, source });
}

export function workers(runtime: Runtime): Response {
  return json({ workers: runtime.workers?.processes() ?? [] });
}

const frame = (event: TaskEvent) =>
  `id: ${String(event.version)}\nevent: task\ndata: ${toJson(event)}\n\n`;

export function events(runtime: Runtime, request: Request, taskId: string): Response {
  const stream = runtime.store.streams[taskId];
  if (stream === undefined) return notFound(`No task ${taskId}`);
  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  const backlog = stream.filter((event) => event.version > after);
  if (!(request.headers.get("accept") ?? "").includes("text/event-stream"))
    return json({ events: backlog });
  const encoder = new TextEncoder();
  let listener: ((event: TaskEvent) => void) | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of backlog) controller.enqueue(encoder.encode(frame(event)));
      listener = (event) => {
        if (event.taskId === taskId) controller.enqueue(encoder.encode(frame(event)));
      };
      runtime.listeners.add(listener);
    },
    cancel() {
      if (listener !== null) runtime.listeners.delete(listener);
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

export function payouts(runtime: Runtime, taskId: string): Response {
  if (runtime.store.records[taskId] === undefined) return notFound(`No task ${taskId}`);
  return json({
    mode: "dry-run quotes from NEAR Intents 1Click at mainnet prices; nothing is swapped",
    quotes: runtime.payouts.get(taskId) ?? [],
  });
}
