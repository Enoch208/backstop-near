import { describe, expect, it } from "vitest";
import { runIsolated } from "../src/isolated.js";

describe("the isolated JavaScript runner", () => {
  it("does not expose host process, file or network APIs", () => {
    const source = `function entry() {
      return ["process", "require", "fetch", "Deno", "WebAssembly"]
        .map((name) => Function("return typeof " + name)());
    }`;
    expect(runIsolated(source, "entry", [null])).toEqual([
      { ok: true, value: ["undefined", "undefined", "undefined", "undefined", "undefined"] },
    ]);
  });

  it("interrupts an infinite loop and can serve the next task", () => {
    const result = runIsolated("function entry() { while (true) {} }", "entry", [null], 25)[0];
    expect(result?.ok).toBe(false);
    if (result?.ok === false) expect(result.error).toMatch(/interrupted/i);
    expect(runIsolated("function entry(x) { return x * 2; }", "entry", [3])).toEqual([
      { ok: true, value: 6 },
    ]);
  });

  it("gives each test case fresh state", () => {
    const source = "let count = 0; function entry() { return ++count; }";
    expect(runIsolated(source, "entry", [null, null])).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 1 },
    ]);
  });

  it("rejects async and non-JSON results before comparing expected values", () => {
    expect(runIsolated("async function entry() { return {}; }", "entry", [null])[0]?.ok).toBe(
      false,
    );
    expect(runIsolated("function entry() { return Infinity; }", "entry", [null])[0]?.ok).toBe(
      false,
    );
  });
});
