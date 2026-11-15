import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { roster } from "@backstop/agents";
import { candidate } from "@backstop/fixture-checkout";
import { digestText, sha256Hex } from "@backstop/shared";
import { addressOfSecret, checkReceipt, signPersonal } from "@backstop/tee";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { diagnose } from "../src/diagnosis.js";
import { produce } from "../src/produce.js";
import { repairFeedback, recoveryStrategyFor } from "../src/recovery-feedback.js";

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
const context = {
  objective: "Repair checkoutTotal.",
  inherited: [],
  history: [],
  resume: null,
  diagnosis: null,
};

afterEach(() => {
  server?.close();
  server = null;
});

describe("live production", () => {
  it("abandons rejected algorithms on hidden-only failures, execution errors, or repeats", () => {
    const source = "function solve(x) {return x;}";
    const rejection = {
      attempt: 1,
      artifactHash: digestText(source),
      publicFailedCaseIds: [],
      heldOutFailures: 1,
      executionErrors: 0,
    };
    expect(recoveryStrategyFor(source, [rejection], "patch")).toBe("rebuild");
    expect(
      recoveryStrategyFor(
        source,
        [{ ...rejection, publicFailedCaseIds: ["public"], executionErrors: 1 }],
        "patch",
      ),
    ).toBe("rebuild");
    const publicFailure = { ...rejection, publicFailedCaseIds: ["public"], heldOutFailures: 0 };
    expect(recoveryStrategyFor(source, [publicFailure], "patch")).toBe("patch");
    expect(
      recoveryStrategyFor(source, [publicFailure, { ...publicFailure, attempt: 2 }], "patch"),
    ).toBe("rebuild");
    expect(recoveryStrategyFor(source + "\n", [rejection], "patch")).toBe("patch");
    const changed = source + "\n";
    const semanticRepeat = { ...publicFailure, attempt: 2, artifactHash: digestText(changed) };
    expect(recoveryStrategyFor(changed, [publicFailure, semanticRepeat], "patch")).toBe("rebuild");
  });

  it("retries the actual failed result and refuses a result that still fails public cases", async () => {
    const prompts: string[] = [];
    const failed = "function checkoutTotal(input) { return { failedRetryMarker: true }; }\n";
    const model = await fakeModel([fenced(failed), fenced(failed)], prompts);
    await expect(
      produce(
        roster.beta,
        { baseUrl: model.baseUrl, apiKey: "test", model: "test/model" },
        context,
      ),
    ).rejects.toThrow(/still fails public verification.*expected .*but got.*failedRetryMarker/u);
    expect(model.calls()).toBe(2);
    expect(prompts[1]).toContain("failedRetryMarker");
    expect(prompts[1]).toContain(digestText(failed));
    expect(prompts[1]).toContain("input");
  });
  it("explains public failures only for the artifact the verifier rejected", () => {
    const source = "function increment(n) { return n; }";
    const brief = {
      source,
      rules: "Return the input plus one.",
      suite: {
        suiteId: "feedback-test",
        entry: "increment",
        cases: [
          { id: "public", visibility: "public" as const, input: 2, expected: 3 },
          { id: "private", visibility: "held_out" as const, input: 884211, expected: 884212 },
        ],
      },
      probes: [],
    };
    const rejection = {
      attempt: 1,
      artifactHash: digestText(source),
      publicFailedCaseIds: ["public"],
      heldOutFailures: 1,
      executionErrors: 0,
    };
    const hints = repairFeedback(source, brief, [rejection]).join("\n");
    expect(hints).toContain("expected 3, got 2");
    expect(hints).toContain("1 held-out failures");
    expect(hints).not.toContain("884211");
    expect(repairFeedback(source + "\n", brief, [rejection])).toEqual([]);
  });

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
      { baseUrl: model.baseUrl, apiKey: "test", model: "test/model", nearAiAttestation: true },
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

  it("hands the coalition diagnostician's finding to the model", async () => {
    const prompts: string[] = [];
    const model = await fakeModel([fenced(candidate("gamma-integer").source)], prompts);
    const resume = {
      source: candidate("beta-boundary").source,
      hash: candidate("beta-boundary").artifactHash,
    };
    const finding = diagnose("checkout-live", 3, "delta", resume);
    await produce(
      roster.gamma,
      { baseUrl: model.baseUrl, apiKey: "test", model: "test/model" },
      { ...context, resume, diagnosis: { from: "delta", finding } },
    );
    expect(prompts[0]).toContain("Diagnosis from delta");
    expect(prompts[0]).toContain(finding.failingCases[0]?.id);
  });

  it("keeps fixture work, clearly labelled, when no model is configured", async () => {
    const product = await produce(roster.beta, null, context);
    expect(product.label).toContain("fixture patch");
  });
});
