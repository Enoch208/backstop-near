import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiClient } from "@backstop/workers";
import { z } from "zod";
import { register, type OutsideAgent } from "./identity.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const taskId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .describe("The task id, as backstop_tasks lists it");

export function backstopMcp(apiUrl: string, agent: OutsideAgent): McpServer {
  const client = apiClient(apiUrl, agent);
  const server = new McpServer({ name: "backstop", version: "1.0.0" });
  let registered = false;

  server.registerTool(
    "backstop_tasks",
    {
      title: "List tasks",
      description: "List every task on this Backstop market with its state and attempt.",
    },
    async () => text((await client.get("/api/tasks")).body),
  );

  server.registerTool(
    "backstop_task",
    {
      title: "Inspect a task",
      description:
        "A task's state, auction, submitted artifact, provisional verdict, challenge deadline and ledger. Use it to find a patch that has passed verification but whose challenge window is still open.",
      inputSchema: { taskId },
    },
    async ({ taskId: id }) => text((await client.get(`/api/tasks/${id}`)).body),
  );

  server.registerTool(
    "backstop_events",
    {
      title: "Read a task's event log",
      description: "The task's append-only event log, optionally only events after a version.",
      inputSchema: { taskId, after: z.int().min(0).optional() },
    },
    async ({ taskId: id, after }) =>
      text((await client.get(`/api/tasks/${id}/events?after=${String(after ?? 0)}`)).body),
  );

  server.registerTool(
    "backstop_artifact",
    {
      title: "Read a submitted patch",
      description: "The JavaScript source of a submitted artifact, by its sha256 artifact hash.",
      inputSchema: { taskId, artifactHash: z.string().regex(/^sha256:[0-9a-f]{64}$/) },
    },
    async ({ taskId: id, artifactHash }) =>
      text((await client.get(`/api/tasks/${id}/artifacts/${artifactHash}`)).body),
  );

  server.registerTool(
    "backstop_challenge",
    {
      title: "Challenge a provisional pass",
      description:
        "Submit one input you believe the provisionally accepted patch gets wrong. The verifier re-runs the patch and the specification's reference on it in its sandbox; if they disagree the challenge is upheld, the patch is rejected and the market reopens. Inputs outside the specification are dismissed.",
      inputSchema: { taskId, input: z.json().describe("The function input, e.g. an order object") },
    },
    async ({ taskId: id, input }) => {
      if (!registered) {
        const outcome = await register(apiUrl, agent);
        registered = outcome.status === 200 || outcome.status === 201;
        if (!registered) return text({ registration: outcome });
      }
      const reply = await client.post(`/api/tasks/${id}/challenge`, { input });
      return text({ agent: agent.id, status: reply.status, result: reply.body });
    },
  );

  return server;
}
