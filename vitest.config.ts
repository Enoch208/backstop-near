import { defineConfig } from "vitest/config";

const workspace = (name: string, root: string) => ({
  test: {
    name,
    root,
    include: ["tests/**/*.test.ts"],
    environment: "node" as const,
  },
});

export default defineConfig({
  test: {
    projects: [
      workspace("shared", "packages/shared"),
      workspace("ledger", "packages/ledger"),
      workspace("fixture-checkout", "fixtures/checkout"),
      workspace("verifier", "services/verifier"),
      workspace("agents", "services/agents"),
      workspace("orchestrator", "services/orchestrator"),
      workspace("workers", "services/workers"),
      workspace("api", "apps/api"),
    ],
  },
});
