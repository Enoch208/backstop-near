import { describe, expect, it } from "vitest";
import { runInSandbox } from "../src/index.js";

const probe = (body: string) => runInSandbox(`function probe() { ${body} }`, "probe", [null]);

describe("the artifact sandbox", () => {
  it("NFR-004 gives artifacts no require, process, network or string evaluation", () => {
    expect(probe("return typeof require + typeof process + typeof fetch;")).toEqual([
      { ok: true, value: "undefinedundefinedundefined" },
    ]);
    expect(probe("return eval('1 + 1');")[0]?.ok).toBe(false);
    expect(probe("return new Function('return 1')();")[0]?.ok).toBe(false);
  });

  it("stops a runaway artifact at the timeout and reports every case as an error", () => {
    const results = runInSandbox("function spin() { for (;;) {} }", "spin", [1, 2], 50);
    expect(results).toHaveLength(2);
    expect(results.every((result) => !result.ok)).toBe(true);
  });

  it("reports a syntax error instead of throwing", () => {
    expect(runInSandbox("function broken( {", "broken", [1])[0]?.ok).toBe(false);
  });
});
