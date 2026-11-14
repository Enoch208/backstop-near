import { defineConfig } from "vitest/config";

const chainProject = (name: string, root: string) => ({
  test: {
    name,
    root,
    include: ["tests/**/*.chain.test.ts"],
    environment: "node" as const,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});

export default defineConfig({
  test: {
    projects: [chainProject("near-chain", "packages/near"), chainProject("api-chain", "apps/api")],
  },
});
