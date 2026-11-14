import { canonicalJson, publicView, type TestSuite } from "@backstop/shared";
import { complete, type ChatMessage, type ModelConfig } from "./model.js";

export type RepairBrief = {
  readonly objective: string;
  readonly brokenSource: string;
  readonly suite: TestSuite;
  readonly validatedSubtasks: readonly string[];
  readonly failureHistory: readonly string[];
};

const system = [
  "You repair one JavaScript function for a paid task.",
  "Reply with only the complete corrected source in a single ```js code block: plain function declarations, no imports, no exports, no comments, no explanation.",
  "Money is integer cents. An independent verifier runs hidden tests, and challengers are paid to find any input where your function disagrees with the specification.",
].join(" ");

export function repairPrompt(brief: RepairBrief): ChatMessage[] {
  const examples = publicView(brief.suite).cases.map((testCase) => ({
    input: testCase.input,
    expected: testCase.expected,
  }));
  const user = [
    `Objective: ${brief.objective}`,
    `Function name: ${brief.suite.entry}`,
    "Current source:",
    "```js",
    brief.brokenSource.trim(),
    "```",
    `Public examples (input and the exact expected output):\n${canonicalJson(examples)}`,
    brief.validatedSubtasks.length > 0
      ? `Already validated by a previous agent's checkpoint: ${brief.validatedSubtasks.join(", ")}.`
      : "No previous checkpoint.",
    brief.failureHistory.length > 0
      ? `Earlier attempts on this task failed because: ${brief.failureHistory.join("; ")}.`
      : "No earlier attempts failed.",
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function extractSource(reply: string): string | null {
  const fenced = /```(?:js|javascript)?\s*\n([\s\S]*?)```/.exec(reply);
  const source = (fenced?.[1] ?? "").trim();
  return source.length > 0 && source.length <= 64_000 ? `${source}\n` : null;
}

export async function proposeRepair(config: ModelConfig, brief: RepairBrief): Promise<string> {
  const source = extractSource(await complete(config, repairPrompt(brief)));
  if (source === null) throw new Error("The model reply held no code block");
  return source;
}
