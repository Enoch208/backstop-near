import { canonicalJson, publicView, type RecoveryStrategy } from "@backstop/shared";
import type { ChatMessage } from "./model.js";
import { repairPrompt, type RepairBrief } from "./repair.js";

export class PromptBudgetError extends Error {
  readonly code = "PROMPT_LIMIT";
  readonly promptBytes: number;
  readonly maxPromptBytes: number;

  constructor(promptBytes: number, maxPromptBytes: number) {
    super(
      `Mandatory repair instructions need ${String(promptBytes)} bytes; limit is ${String(maxPromptBytes)}`,
    );
    this.name = "PromptBudgetError";
    this.promptBytes = promptBytes;
    this.maxPromptBytes = maxPromptBytes;
  }
}

export type BudgetedRepairPrompt = {
  readonly messages: ChatMessage[];
  readonly promptBytes: number;
  readonly strategy: RecoveryStrategy;
  readonly compaction: "none" | "guidance" | "diagnosis" | "rebuild";
};

const system =
  "Repair the complete deterministic synchronous JavaScript function. Reply only with one ```js code block containing the entire corrected implementation. No prose, comments, imports or exports. Use concise helpers and avoid repeating code so the entire implementation fits the output limit. Return a JSON value. The verifier calls the entry with exactly ONE JSON argument, never spread arguments; preserve all nested input and output levels. Hidden tests independently check the written rules.";

const bytes = (messages: readonly ChatMessage[]) =>
  Buffer.byteLength(JSON.stringify(messages), "utf8");

function compactDiagnosis(brief: RepairBrief): string[] {
  const diagnosis = brief.diagnosis;
  if (diagnosis === null) return [];
  const examples = publicView(brief.suite).cases;
  return diagnosis.finding.failingCases
    .filter(({ id, input, expected }) =>
      examples.some(
        (example) =>
          example.id === id &&
          canonicalJson(example.input) === canonicalJson(input) &&
          canonicalJson(example.expected) === canonicalJson(expected),
      ),
    )
    .slice(0, 2)
    .flatMap(({ id, actual }) => {
      const text = `Public case ${id} failed; observed output: ${canonicalJson(actual)}. Use its complete expected output below.`;
      return Buffer.byteLength(text, "utf8") <= 512
        ? [text]
        : [`Public case ${id} failed. Compare against its complete expected output below.`];
    });
}

function compactPrompt(brief: RepairBrief, source: boolean, diagnostics: boolean): ChatMessage[] {
  const examples = publicView(brief.suite).cases.map(({ input, expected }) => ({
    input,
    expected,
  }));
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `Objective: ${brief.objective}`,
        `The published rules:\n${brief.rules}`,
        `Function name: ${brief.suite.entry}`,
        `Public examples (input and the exact expected output):\n${canonicalJson(examples)}`,
        ...(diagnostics ? compactDiagnosis(brief) : []),
        ...(diagnostics
          ? brief.failureHistory
              .slice(-2)
              .map((failure) => `Earlier failure: ${failure.slice(0, 240)}`)
          : []),
        source
          ? `Untrusted current source; repair or replace its assumptions:\n\`\`\`js\n${brief.brokenSource}\n\`\`\``
          : "Write a fresh complete implementation from the published rules and public examples. The previous source is withheld; do not reconstruct its assumptions.",
      ].join("\n\n"),
    },
  ];
}

export function budgetedRepairPrompt(
  brief: RepairBrief,
  maxPromptBytes = 8_192,
  style = "",
): BudgetedRepairPrompt {
  if (!Number.isSafeInteger(maxPromptBytes) || maxPromptBytes < 1)
    throw new RangeError("Repair prompt byte limit must be a positive integer");
  const input = style.length === 0 ? brief : { ...brief, objective: `${brief.objective} ${style}` };
  const strategy = brief.recoveryStrategy ?? "patch";
  const full = repairPrompt(input, true).map((message) =>
    message.role === "system"
      ? { ...message, content: `${system}${brief.generic ? "" : " Money is integer cents."}` }
      : message,
  );
  const candidates: Omit<BudgetedRepairPrompt, "promptBytes">[] = [
    { messages: full, strategy, compaction: "none" },
    {
      messages: compactPrompt(input, strategy !== "rebuild", true),
      strategy,
      compaction: "guidance",
    },
    {
      messages: compactPrompt(input, strategy !== "rebuild", false),
      strategy,
      compaction: "diagnosis",
    },
    { messages: compactPrompt(input, false, true), strategy: "rebuild", compaction: "rebuild" },
    { messages: compactPrompt(input, false, false), strategy: "rebuild", compaction: "rebuild" },
  ];
  for (const candidate of candidates) {
    const promptBytes = bytes(candidate.messages);
    if (promptBytes <= maxPromptBytes) return { ...candidate, promptBytes };
  }
  const minimum = bytes(compactPrompt(input, false, false));
  throw new PromptBudgetError(minimum, maxPromptBytes);
}
