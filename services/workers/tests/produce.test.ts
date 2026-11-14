import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { roster } from "@backstop/agents";
import { candidate } from "@backstop/fixture-checkout";
import { sha256Hex } from "@backstop/shared";
import { addressOfSecret, checkReceipt, signPersonal } from "@backstop/tee";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { produce } from "../src/produce.js";

let server: Server | null = null;

const teeSecret = sha256(utf8ToBytes("stand-in tee key"));
const teeAddress = addressOfSecret(teeSecret);

async function fakeModel(
  replies: readonly string[],
  prompts: string[] = [],
): Promise<{ baseUrl: string; calls: () => number }> {
  let calls = 0;
  const signed = new Map<string, string>();
  server = createServer((request, response) => {
    let requestBody = "";
    request.on("data", (chunk: Buffer) => (requestBody += chunk.toString("utf8")));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      const signature = /^\/signature\/([^?]+)/.exec(request.url ?? "");
      if (signature?.[1] !== undefined) {
        const text = signed.get(signature[1]) ?? "";
        response.end(
          JSON.stringify({
            text,
            signature: signPersonal(text, teeSecret),
            signing_address: teeAddress,
          }),
        );
        return;
      }
      prompts.push(requestBody);
      const content = replies[Math.min(calls, replies.length - 1)] ?? "";
      calls += 1;
      const id = `chat-${String(calls)}`;
      const body = JSON.stringify({ id, choices: [{ message: { content } }] });
      signed.set(id, `test/model:${sha256Hex(requestBody)}:${sha256Hex(body)}`);
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, calls: () => calls };
}

const fenced = (source: string) => `\`\`\`js\n${source}\`\`\``;
const context = { objective: "Repair checkoutTotal.", inherited: [], history: [], resume: null };

afterEach(() => {
  server?.close();
  server = null;
});

describe("live production", () => {
  it("submits the model's patch only after running the public tests itself", async () => {
    const model = await fakeModel([fenced(candidate("gamma-integer").source)]);
    const product = await produce(
      roster.gamma,
      { baseUrl: model.baseUrl, apiKey: "test", model: "test/model" },
      context,
    );
    expect(model.calls()).toBe(1);
    expect(product).toMatchObject({ completes: true, uri: "live-ai://test/model" });
    expect(product.validatedSubtasks).toHaveLength(4);
  });

  it("carries the TEE signature over the exact request and reply that produced the patch", async () => {
    const model = await fakeModel([fenced(candidate("gamma-integer").source)]);
    const product = await produce(
      roster.gamma,
      { baseUrl: model.baseUrl, apiKey: "test", model: "test/model" },
      context,
    );
    expect(product.label).toContain("TEE-signed");
    if (product.inference === null) throw new Error("no receipt");
    const check = checkReceipt(product.inference, new Map([[teeAddress, "test/model"]]));
    expect(check).toMatchObject({ ok: true });
    if (check.ok) expect(check.content).toContain(candidate("gamma-integer").source.trim());
  });

  it("feeds its own failing public run back to the model once", async () => {
    const model = await fakeModel([
      fenced(candidate("original").source),
      fenced(candidate("gamma-integer").source),
    ]);
    const product = await produce(
      roster.beta,
      { baseUrl: model.baseUrl, apiKey: "test", model: "test/model" },
      context,
    );
    expect(model.calls()).toBe(2);
    expect(product.source).toBe(candidate("gamma-integer").source);
  });

  it("repairs the previous agent's checkpointed code, not the original", async () => {
    const prompts: string[] = [];
    const model = await fakeModel([fenced(candidate("gamma-integer").source)], prompts);
    const resume = {
      source: candidate("alpha-partial").source,
      hash: candidate("alpha-partial").artifactHash,
    };
    await produce(
      roster.gamma,
      { baseUrl: model.baseUrl, apiKey: "test", model: "test/model" },
      { ...context, resume },
    );
    expect(prompts[0]).toContain(resume.hash);
    expect(prompts[0]).toContain(
      JSON.stringify(candidate("alpha-partial").source.trim()).slice(1, 40),
    );
  });

  it("keeps fixture work, clearly labelled, when no model is configured", async () => {
    const product = await produce(roster.beta, null, context);
    expect(product.label).toContain("fixture patch");
  });
});
