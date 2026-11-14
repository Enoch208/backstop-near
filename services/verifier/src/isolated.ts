import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import { z } from "zod";
import { defaultTimeoutMs, type RunResult } from "./sandbox.js";

const quickJs = await getQuickJS();
const entryName = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const maxJsonLength = 64_000;
const errorObject = z.object({ message: z.string() });

function harness(source: string, entry: string, input: unknown): string {
  const body = `"use strict";\n${source}\nreturn ${entry};`;
  return `
    (function () {
      const stringify = JSON.stringify;
      const array = Array.isArray;
      const prototype = Object.getPrototypeOf;
      const plainObject = Object.prototype;
      const finite = Number.isFinite;
      const input = JSON.parse(${JSON.stringify(JSON.stringify(input))});
      globalThis.Date = undefined;
      Math.random = undefined;
      const solve = Function(${JSON.stringify(body)})();
      return stringify(solve(input), function (_key, value) {
        if (value === null || typeof value === "string" || typeof value === "boolean") return value;
        if (typeof value === "number" && finite(value)) return value;
        if (typeof value === "object" && (array(value) || prototype(value) === plainObject || prototype(value) === null)) return value;
        throw "The function must return JSON values";
      });
    })()
  `;
}

export function runIsolated(
  source: string,
  entry: string,
  inputs: readonly unknown[],
  timeoutMs = defaultTimeoutMs,
): RunResult[] {
  const deadline = Date.now() + timeoutMs;
  return inputs.map((input) => {
    if (!entryName.test(entry) || source.length > maxJsonLength) {
      return { ok: false, error: "The source or entry name is outside the runner limits" };
    }
    if (Date.now() >= deadline) return { ok: false, error: "The runner time limit was reached" };
    try {
      const output: unknown = quickJs.evalCode(harness(source, entry, input), {
        memoryLimitBytes: 8 * 1024 * 1024,
        maxStackSizeBytes: 128 * 1024,
        shouldInterrupt: shouldInterruptAfterDeadline(deadline),
      });
      const json = z.string().max(maxJsonLength).parse(output);
      return { ok: true, value: z.json().parse(JSON.parse(json)) };
    } catch (error) {
      const detail = errorObject.safeParse(error);
      const reason = detail.success
        ? detail.data.message
        : "The isolated runner rejected the input";
      return { ok: false, error: reason.slice(0, 240) };
    }
  });
}
