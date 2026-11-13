import type { Principal } from "@backstop/agents";
import { signRequest, type Json } from "@backstop/shared";

export type Reply = { readonly status: number; readonly body: unknown };

export type ApiClient = {
  readonly post: (path: string, body: Json) => Promise<Reply>;
  readonly get: (path: string) => Promise<Reply>;
  readonly follow: (taskId: string, onEvent: (event: unknown) => void) => Promise<void>;
};

async function reply(response: Response): Promise<Reply> {
  return { status: response.status, body: await response.json() };
}

function frames(buffer: string): { events: unknown[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.flatMap((part) => {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    return data === "" ? [] : [JSON.parse(data) as unknown];
  });
  return { events, rest };
}

export function apiClient(baseUrl: string, identity: Principal): ApiClient {
  const post = async (path: string, body: Json) => {
    const signed = signRequest(
      { actor: identity.id, requestId: crypto.randomUUID(), issuedAtMs: Date.now(), body },
      { method: "POST", path },
      identity.key,
    );
    return reply(
      await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signed),
      }),
    );
  };
  const get = async (path: string) => reply(await fetch(`${baseUrl}${path}`));
  const follow = async (taskId: string, onEvent: (event: unknown) => void) => {
    const response = await fetch(`${baseUrl}/api/tasks/${taskId}/events`, {
      headers: { accept: "text/event-stream" },
    });
    if (!response.ok || response.body === null) {
      throw new Error(`No event stream for ${taskId} (HTTP ${String(response.status)})`);
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) continue;
      buffer += decoder.decode(chunk, { stream: true });
      const parsed = frames(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) onEvent(event);
    }
  };
  return { post, get, follow };
}
