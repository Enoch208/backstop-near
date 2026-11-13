import { createContext, Script } from "node:vm";
import { z } from "zod";

export const defaultTimeoutMs = 1_000;

const runResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: z.json() }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type RunResult = z.infer<typeof runResultSchema>;

const harness = (entry: string) =>
  [
    ";JSON.stringify(JSON.parse(backstopInputs).map(function (input) {",
    `  try { return { ok: true, value: ${entry}(input) }; }`,
    "  catch (error) { return { ok: false, error: String(error) }; }",
    "}));",
  ].join("\n");

export function runInSandbox(
  source: string,
  entry: string,
  inputs: readonly unknown[],
  timeoutMs: number = defaultTimeoutMs,
): RunResult[] {
  const context = createContext(
    { backstopInputs: JSON.stringify(inputs) },
    { codeGeneration: { strings: false, wasm: false } },
  );
  try {
    const script = new Script(`"use strict";\n${source}\n${harness(entry)}`, {
      filename: "artifact.js",
    });
    const output: unknown = script.runInContext(context, { timeout: timeoutMs });
    if (typeof output !== "string") throw new TypeError("The harness returned no results");
    return z.array(runResultSchema).length(inputs.length).parse(JSON.parse(output));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return inputs.map(() => ({ ok: false, error: reason }));
  }
}
