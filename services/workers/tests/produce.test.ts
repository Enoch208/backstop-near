import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { roster } from "@backstop/agents";
import { candidate } from "@backstop/fixture-checkout";
import { produce } from "../src/produce.js";

let server: Server | null = null;

async function fakeModel(
  replies: readonly string[],
): Promise<{ baseUrl: string; calls: () => number }> {
  let calls = 0;
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const content = replies[Math.min(calls, replies.length - 1)] ?? "";
      calls += 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, calls: () => calls };
}

const fenced = (source: string) => `\`\`\`js\n${source}\`\`\``;
const context = { objective: "Repair checkoutTotal.", inherited: [], history: [] };

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

  it("keeps fixture work, clearly labelled, when no model is configured", async () => {
    const product = await produce(roster.beta, null, context);
    expect(product.label).toContain("fixture patch");
  });
});
