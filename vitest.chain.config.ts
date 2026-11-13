import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "chain",
    root: "packages/near",
    include: ["tests/**/*.chain.test.ts"],
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
