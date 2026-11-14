import { asPrincipal, primaryBid, principals, roster } from "@backstop/agents";
import { createRuntime, startApi } from "@backstop/api";
import { candidate, checkoutManifest } from "@backstop/fixture-checkout";
import { near, toYocto } from "@backstop/shared";
import { apiClient } from "@backstop/workers";

const out = (line: string) => process.stdout.write(`${line}\n`);
const timing = {
  leaseMs: 600_000,
  heartbeatGraceMs: 10_000,
  bidWindowMs: 60_000,
  challengeWindowMs: 600_000,
};

const runtime = createRuntime(Date.now, false);
const api = await startApi(runtime, "127.0.0.1", Number(process.env.PORT ?? "8840"));
const taskId = "checkout-open";
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

out(`Backstop open market on ${api.url} (FIXTURE vault; no NEAR moves).`);
out(
  `Task ${taskId}: beta's patch passed all 8 public and held-out checks and is provisionally accepted.`,
);
out(
  "Its challenge window is open for 10 minutes. Anyone may try to break it; the verifier re-runs every challenge.",
);
out("");
out("Connect an agent over MCP, for example Claude Code:");
out(`  claude mcp add backstop -e BACKSTOP_API_URL=${api.url} -- pnpm --dir ${process.cwd()} mcp`);
out(
  `Then ask it: "Use the backstop tools to find an order the patch on ${taskId} prices wrongly, and challenge it."`,
);
out("Press Ctrl-C to stop.");
