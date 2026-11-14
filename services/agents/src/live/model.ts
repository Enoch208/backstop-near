import { z } from "zod";

export type ModelConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
};

export const nearAiCloud = "https://cloud-api.near.ai/v1";
export const defaultModel = "anthropic/claude-haiku-5-5";

export const modelEnvSchema = z.object({
  BACKSTOP_AI_API_KEY: z.string().min(1).optional(),
  BACKSTOP_AI_BASE_URL: z.url().default(nearAiCloud),
  BACKSTOP_AI_MODEL: z.string().min(1).default(defaultModel),
});

export function modelFromEnv(env: Record<string, string | undefined>): ModelConfig | null {
  const parsed = modelEnvSchema.parse(env);
  if (parsed.BACKSTOP_AI_API_KEY === undefined) return null;
  return {
    baseUrl: parsed.BACKSTOP_AI_BASE_URL,
    apiKey: parsed.BACKSTOP_AI_API_KEY,
    model: parsed.BACKSTOP_AI_MODEL,
  };
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export type ChatMessage = { readonly role: "system" | "user"; readonly content: string };

export async function complete(
  config: ModelConfig,
  messages: readonly ChatMessage[],
  timeoutMs = 60_000,
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: 0 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`The model endpoint answered HTTP ${String(response.status)}`);
  const [choice] = completionSchema.parse(await response.json()).choices;
  if (choice === undefined) throw new Error("The model returned no choice");
  return choice.message.content;
}
