import { extractSource, nearAiCloud, type ChatMessage, type ModelConfig } from "@backstop/agents";
import { z } from "zod";

const completion = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.int().nonnegative(),
      completion_tokens: z.int().nonnegative(),
    })
    .optional(),
});

export const limits = {
  calls: 3,
  maxPromptBytes: 8_192,
  maxOutputTokens: 960,
  maxSourceBytes: 4_096,
  wallMs: 240_000,
  callMs: 45_000,
} as const;

export const inferenceSchema = z.object({
  source: z.string().nullable(),
  promptTokens: z.int().nullable(),
  outputTokens: z.int().nullable(),
  promptBytes: z.int(),
  elapsedMs: z.int(),
  status: z.string(),
});

export type Inference = {
  readonly source: string | null;
  readonly promptTokens: number | null;
  readonly outputTokens: number | null;
  readonly promptBytes: number;
  readonly elapsedMs: number;
  readonly status: string;
};

export async function infer(
  config: ModelConfig,
  messages: readonly ChatMessage[],
  deadlineMs: number,
): Promise<Inference> {
  const start = performance.now();
  const promptBytes = Buffer.byteLength(JSON.stringify(messages));
  const result = (
    status: string,
    source: string | null = null,
    promptTokens: number | null = null,
    outputTokens: number | null = null,
  ): Inference => ({
    status,
    source,
    promptTokens,
    outputTokens,
    promptBytes,
    elapsedMs: Math.round(performance.now() - start),
  });
  if (promptBytes > limits.maxPromptBytes) return result("prompt-too-large");
  const timeoutMs = Math.min(limits.callMs, Math.floor(deadlineMs - start));
  if (timeoutMs <= 0) return result("deadline");
  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`);
  const nearCloud = url.origin === new URL(nearAiCloud).origin;
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        ...(url.hostname === "api.openai.com"
          ? { max_completion_tokens: limits.maxOutputTokens }
          : { max_tokens: limits.maxOutputTokens }),
        ...(nearCloud && { chat_template_kwargs: { thinking: false } }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return result(`provider-http-${String(response.status)}`);
    const parsed = completion.safeParse(await response.json());
    if (!parsed.success) return result("invalid-provider-response");
    const choice = parsed.data.choices[0];
    const promptTokens = parsed.data.usage?.prompt_tokens ?? null;
    const outputTokens = parsed.data.usage?.completion_tokens ?? null;
    if (outputTokens !== null && outputTokens > limits.maxOutputTokens)
      return result("provider-output-budget-exceeded", null, promptTokens, outputTokens);
    const source = extractSource(choice?.message.content ?? "");
    if (
      source === null ||
      Buffer.byteLength(source) > limits.maxSourceBytes ||
      choice?.finish_reason === "length"
    ) {
      return result("invalid-or-truncated-code", null, promptTokens, outputTokens);
    }
    return result("ok", source, promptTokens, outputTokens);
  } catch (error) {
    const status =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "provider-timeout"
        : "provider-transport-or-json-error";
    return result(status);
  }
}
