import { describe, expect, it, vi, afterEach } from "vitest";
import { canonicalJson, type SuiteCase } from "@backstop/shared";
import {
  budgetedRepairPrompt,
  PromptBudgetError,
  InvalidRepairOutputError,
  proposeRepair,
  repairPrompt,
  type RepairBrief,
} from "../src/index.js";

const cases: SuiteCase[] = [
  {
    id: "public-1",
    visibility: "public",
    input: [[["()()", "(())"]], [-8, -2], [5]],
    expected: [[1, 2], true, [1, 3, 2, 8, 3, 14]],
  },
  { id: "public-2", visibility: "public", input: [[""], [0, 0], [0]], expected: [[], true, [1]] },
  {
    id: "private-marker",
    visibility: "held_out",
    input: "never-send-this-hidden-input",
    expected: "never-send-this-hidden-answer",
  },
];
const brief: RepairBrief = {
  objective: "Repair a module of three independent computations.",
  rules:
    "Take one JSON argument [argsA,argsB,argsC]. Preserve nesting and return all three results. A returns maximum parenthesis group depths. B determines whether x is a nonnegative integral power of n, including zero and negative bases. C returns the sequence defined by the task's recurrence.",
  brokenSource: "function solve(args) { return args; }",
  resumedFrom: "checkpoint",
  suite: { entry: "solve", cases },
  generic: true,
  recoveryStrategy: "patch",
  validatedSubtasks: [],
  failureHistory: ["VERDICT_REJECTED"],
  diagnosis: {
    from: "public-preflight",
    finding: {
      notes: "Public case failed.",
      failingCases: [
        {
          id: "public-1",
          input: cases[0]?.input ?? null,
          expected: cases[0]?.expected ?? null,
          actual: [[], false, []],
        },
      ],
    },
  },
};

function verifyMandatory(packed: ReturnType<typeof budgetedRepairPrompt>, input = brief) {
  const text = packed.messages.map(({ content }) => content).join("\n");
  expect(text).toContain(input.objective);
  expect(text).toContain(input.rules);
  expect(text).toContain("Function name: solve");
  for (const test of input.suite.cases.filter(({ visibility }) => visibility === "public")) {
    expect(text).toContain(canonicalJson(test.input));
    expect(text).toContain(canonicalJson(test.expected));
  }
  expect(text).not.toContain("never-send-this-hidden-input");
  expect(text).not.toContain("never-send-this-hidden-answer");
  expect(text).toContain("ONE JSON argument");
  expect(packed.promptBytes).toBe(Buffer.byteLength(JSON.stringify(packed.messages), "utf8"));
  expect(packed.promptBytes).toBeLessThanOrEqual(8192);
}

afterEach(() => vi.unstubAllGlobals());

describe("repair prompt byte budget", () => {
  it("preserves instructions and public cases while reserving output for complete code", () => {
    const packed = budgetedRepairPrompt(brief);
    expect(packed.compaction).toBe("none");
    expect(packed.strategy).toBe("patch");
    expect(packed.messages[0]?.content).toContain("Reply only with one");
    expect(JSON.stringify(packed.messages)).not.toContain("concise summary");
    expect(JSON.stringify(packed.messages)).not.toContain("at most 80 words");
    expect(repairPrompt(brief)[0]?.content).toContain("at most 80 words");
    verifyMandatory(packed);
  });

  it("fits long failure diagnostics without dropping the source when guidance can be compacted", () => {
    const input = {
      ...brief,
      failureHistory: ["diagnostic ".repeat(1000)],
      diagnosis: {
        from: "public-preflight",
        finding: {
          notes: "details ".repeat(1000),
          failingCases: brief.diagnosis?.finding.failingCases ?? [],
        },
      },
    };
    expect(Buffer.byteLength(JSON.stringify(repairPrompt(input)))).toBeGreaterThan(8192);
    const packed = budgetedRepairPrompt(input);
    expect(packed.compaction).toBe("guidance");
    expect(packed.strategy).toBe("patch");
    expect(JSON.stringify(packed.messages)).toContain(input.brokenSource);
    verifyMandatory(packed, input);
  });

  it("rebuilds instead of truncating a failed source that cannot fit", () => {
    const input = {
      ...brief,
      brokenSource: `function solve(args) { const cache = ${JSON.stringify("previous-source-marker".repeat(500))}; return cache; }`,
    };
    const packed = budgetedRepairPrompt(input);
    expect(packed.compaction).toBe("rebuild");
    expect(packed.strategy).toBe("rebuild");
    const text = packed.messages.map(({ content }) => content).join("\n");
    expect(text).not.toContain("previous-source-marker");
    expect(text).toContain("fresh complete implementation");
    verifyMandatory(packed, input);
  });

  it("accounts for Unicode UTF8 bytes and operator instructions before accepting a prompt", () => {
    const input = { ...brief, rules: `${brief.rules} ${"雪".repeat(1400)}` };
    const packed = budgetedRepairPrompt(input, 8192, "Use exact integer comparisons.");
    expect(packed.promptBytes).toBeGreaterThan(JSON.stringify(packed.messages).length);
    expect(packed.messages.map(({ content }) => content).join("\n")).toContain(
      "Use exact integer comparisons.",
    );
    verifyMandatory(packed, input);
  });

  it("refuses an irreducible task explicitly rather than truncating mandatory rules", () => {
    const input = { ...brief, rules: "mandatory rule ".repeat(1000) };
    try {
      budgetedRepairPrompt(input);
      throw new Error("Expected prompt refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(PromptBudgetError);
      if (!(error instanceof PromptBudgetError)) throw error;
      expect(error.code).toBe("PROMPT_LIMIT");
      expect(error.promptBytes).toBeGreaterThan(error.maxPromptBytes);
    }
  });

  it("refuses oversized mandatory public examples without a provider request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      proposeRepair(
        { baseUrl: "https://example.test/v1", model: "test", apiKey: "test" },
        {
          ...brief,
          suite: {
            entry: "solve",
            cases: [{ id: "large", visibility: "public", input: "x".repeat(9000), expected: 1 }],
          },
        },
      ),
    ).rejects.toBeInstanceOf(PromptBudgetError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an incomplete code reply with an explicit output failure type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "reply",
            choices: [{ message: { content: "```js\nfunction solve(args) {" } }],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      proposeRepair(
        {
          baseUrl: "https://example.test/v1",
          model: "test",
          apiKey: "test",
          nearAiAttestation: false,
        },
        brief,
      ),
    ).rejects.toBeInstanceOf(InvalidRepairOutputError);
  });
});
