import { addressSchema, ethSignatureSchema, type InferenceReceipt } from "@backstop/tee";
import { z } from "zod";

export type ModelConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
};

export const nearAiCloud = "https://cloud-api.near.ai/v1";
export const defaultModel = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

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
  id: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const signatureSchema = z.object({
  text: z.string().min(1),
  signature: ethSignatureSchema,
  signing_address: addressSchema,
});

export type ChatMessage = { readonly role: "system" | "user"; readonly content: string };

export type Completion = {
  readonly content: string;
  readonly receipt: InferenceReceipt | null;
  readonly unsigned: string | null;
};

async function receiptFor(
  config: ModelConfig,
  chatId: string,
  requestBody: string,
  responseBody: string,
  timeoutMs: number,
): Promise<{ receipt: InferenceReceipt | null; unsigned: string | null }> {
  const query = `model=${encodeURIComponent(config.model)}&signing_algo=ecdsa`;
  const response = await fetch(
    `${config.baseUrl}/signature/${encodeURIComponent(chatId)}?${query}`,
    {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok)
    return {
      receipt: null,
      unsigned: `NEAR AI Cloud gave no signature (HTTP ${String(response.status)})`,
    };
  const signed = signatureSchema.parse(await response.json());
  return {
    unsigned: null,
    receipt: {
      provider: "near-ai-cloud",
      model: config.model,
      chatId,
      requestBody,
      responseBody,
      signedText: signed.text,
      signature: signed.signature,
      signingAddress: signed.signing_address,
    },
  };
}

export async function complete(
  config: ModelConfig,
  messages: readonly ChatMessage[],
  timeoutMs = 60_000,
): Promise<Completion> {
  const requestBody = JSON.stringify({ model: config.model, messages, temperature: 0 });
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: requestBody,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`The model endpoint answered HTTP ${String(response.status)}`);
  const responseBody = await response.text();
  const parsed = completionSchema.parse(JSON.parse(responseBody));
  const [choice] = parsed.choices;
  if (choice === undefined) throw new Error("The model returned no choice");
  const signed = await receiptFor(config, parsed.id, requestBody, responseBody, timeoutMs);
  return { content: choice.message.content, ...signed };
}
