import { canonicalJson } from "@backstop/shared";
import { runIsolated } from "@backstop/verifier";
import type { TaskDefinition, Value } from "./tasks.js";

function moduleSource(components: readonly TaskDefinition[], kind: "reference" | "starter") {
  const calls = components.map(
    (task, index) => `(()=>{${task[kind]}\nreturn ${task.entry}(args[${String(index)}]);})()`,
  );
  return `function solve(args) {return [${calls.join(",")}];}`;
}

export function combineDiversityTasks(
  definitions: readonly TaskDefinition[],
): readonly TaskDefinition[] {
  if (definitions.length !== 10) throw new Error("Composite corpus requires ten components");
  return definitions.map((_, index) => {
    const components = [index, (index + 3) % 10, (index + 7) % 10].map((offset) => {
      const task = definitions[offset];
      if (task === undefined) throw new Error("Missing composite component");
      return task;
    });
    const inputs = (kind: "visible" | "acceptance" | "audit", count: number): Value[] =>
      Array.from({ length: count }, (_, row) =>
        components.map((task) => {
          const value = task[kind][row % task[kind].length];
          if (value === undefined) throw new Error("Missing composite input");
          return value;
        }),
      );
    const reference = moduleSource(components, "reference");
    const visible = inputs("visible", 4);
    const outputs = runIsolated(reference, "solve", visible, 1_000);
    const publicTable = visible.map((input, row) => {
      const result = outputs[row];
      if (result?.ok !== true) throw new Error("Composite public reference failed");
      return [canonicalJson(input), result.value];
    });
    return {
      id: `module-${components.map(({ id }) => id.replace("he-", "")).join("-")}`,
      objective: "Repair a module containing three independent JavaScript computations.",
      rules: [
        "solve([argsA,argsB,argsC]) receives ONE JSON input. Each argsX is the positional-argument array for component X. Return [resultA,resultB,resultC], preserving each result's nesting. Compute all three independently.",
        ...components.map(
          (task, offset) =>
            `Component ${["A", "B", "C"][offset] ?? ""} at index ${String(offset)}: ${task.rules.replace(/^Implement solve\(args\) using the following rules\. args is a JSON array holding the original task's positional arguments\. /u, "")}`,
        ),
      ].join("\n"),
      entry: "solve",
      starter: moduleSource(components, "starter"),
      reference,
      visible,
      acceptance: inputs("acceptance", 12),
      audit: inputs("audit", 48),
      mutant: `function solve(args) {const examples=${JSON.stringify(publicTable)};const encode=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(encode).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+encode(x[k])).join(',')+'}';const found=examples.find(([key])=>key===encode(args));return found?found[1]:null;}`,
      anchors: [],
    };
  });
}
