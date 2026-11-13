import { existsSync, readFileSync } from "node:fs";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

const pureCorePaths = [
  "packages/shared/src/**",
  "packages/ledger/src/**",
  "services/orchestrator/src/core/**",
];

const ioShell = {
  group: ["node:*", "fs", "fs/*", "child_process", "net", "http", "https", "vm", "worker_threads"],
  message:
    "The core is pure: no filesystem, process, network or sandbox access. Do IO in a service.",
};

const services = {
  group: ["@backstop/verifier", "@backstop/agents", "@backstop/fixture-checkout"],
  message: "The core never depends on a service or a fixture; services depend on the core.",
};

const deterministic = [
  {
    object: "Math",
    property: "random",
    message: "Seed randomness explicitly; the core is deterministic.",
  },
  { object: "Date", property: "now", message: "Inject a clock; the core is deterministic." },
  {
    object: "performance",
    property: "now",
    message: "Inject a clock; the core is deterministic.",
  },
];

const localExclude = new URL(".git/info/exclude", import.meta.url);
const localIgnores = existsSync(localExclude)
  ? readFileSync(localExclude, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
      .map((line) => (line.endsWith("/") ? `${line}**` : line))
  : [];

export default tseslint.config(
  {
    ignores: [
      ...localIgnores,
      "**/node_modules/**",
      "**/dist/**",
      "coverage/**",
      "contracts/**/target/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-console": "error",
    },
  },
  {
    files: pureCorePaths,
    rules: {
      "no-restricted-imports": ["error", { patterns: [ioShell, services] }],
      "no-restricted-properties": ["error", ...deterministic],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Inject a clock; the core is deterministic.",
        },
      ],
    },
  },
  {
    files: ["**/*.js", "*.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["fixtures/*/candidates/**/*.js", "fixtures/*/suite/**/*.js"],
    languageOptions: { sourceType: "script", globals: {} },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { vars: "local" }],
    },
  },
);
