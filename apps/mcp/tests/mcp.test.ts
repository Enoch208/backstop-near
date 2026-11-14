import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { asPrincipal, primaryBid, principals, roster } from "@backstop/agents";
import { createRuntime, startApi, type ApiServer } from "@backstop/api";
import { candidate, checkoutManifest } from "@backstop/fixture-checkout";
import { near, toYocto } from "@backstop/shared";
import { apiClient } from "@backstop/workers";
import { z } from "zod";
import { backstopMcp, outsideAgent } from "../src/index.js";

const taskId = "checkout-mcp";
const timing = {
  leaseMs: 60_000,
  heartbeatGraceMs: 5_000,
  bidWindowMs: 5_000,
  challengeWindowMs: 60_000,
};
let api: ApiServer;
let client: Client;

const textOf = (result: unknown) =>
  z
    .object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1) })
    .parse(result).content[0]?.text ?? "";

beforeAll(async () => {
  api = await startApi(createRuntime(Date.now, false), "127.0.0.1", 0, 100);
  const customer = apiClient(api.url, principals.customer);
  const beta = apiClient(api.url, asPrincipal(roster.beta));
  const fund = (pool: string, amount: string) => ({
    pool,
    amountYocto: toYocto(near(amount)),
    liabilityYocto: null,
  });
  await customer.post("/api/tasks", {
    manifest: checkoutManifest({ taskId, createdAtMs: Date.now(), maxAttempts: 3, timing }),
  });
  await customer.post(`/api/tasks/${taskId}/funding`, fund("escrow", "0.40"));
  await customer.post(`/api/tasks/${taskId}/funding`, fund("premium", "0.04"));
  await apiClient(api.url, principals.guarantor).post(
    `/api/tasks/${taskId}/funding`,
    fund("bond", "0.25"),
  );
  await beta.post(`/api/tasks/${taskId}/bids`, {
    bid: primaryBid(roster.beta, taskId, "0.30", Date.now()),
  });
  await beta.post(`/api/tasks/${taskId}/claim`, {});
  await beta.post(`/api/tasks/${taskId}/artifacts`, {
    fencingToken: 1,
    source: candidate("beta-boundary").source,
    checkpointHash: null,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await backstopMcp(api.url, outsideAgent("mcp-test-seed", "outside-judge")).connect(serverSide);
  client = new Client({ name: "judge", version: "1.0.0" });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  await api.close();
});

describe("the Backstop MCP server", () => {
  it("offers outside agents the market's read tools and the challenge", async () => {
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual([
      "backstop_artifact",
      "backstop_challenge",
      "backstop_events",
      "backstop_task",
      "backstop_tasks",
    ]);
    expect(textOf(await client.callTool({ name: "backstop_tasks", arguments: {} }))).toContain(
      taskId,
    );
  });

  it("lets an outside agent read the provisionally passing patch", async () => {
    const view = JSON.parse(
      textOf(await client.callTool({ name: "backstop_task", arguments: { taskId } })),
    ) as unknown;
    const artifactHash = z
      .object({
        task: z.object({
          state: z.literal("VERIFYING"),
          candidate: z.object({ artifactHash: z.string() }),
        }),
      })
      .parse(view).task.candidate.artifactHash;
    const artifact = textOf(
      await client.callTool({ name: "backstop_artifact", arguments: { taskId, artifactHash } }),
    );
    expect(artifact).toContain("freeShippingThresholdCents");
  });

  it("registers an outside challenger and upholds its reproducible counterexample", async () => {
    const input = {
      lines: [{ sku: "coat", unitPriceCents: 10_000, quantity: 1 }],
      discountPercent: 0,
      taxRateBps: 0,
      shippingCents: 999,
      freeShippingThresholdCents: 10_000,
    };
    const result = textOf(
      await client.callTool({ name: "backstop_challenge", arguments: { taskId, input } }),
    );
    expect(result).toContain("attempt_rejected");
    expect(result).toContain("outside-judge");
    const after = textOf(await client.callTool({ name: "backstop_task", arguments: { taskId } }));
    expect(after).toContain("RECOVERY_OPEN");
  });
});
