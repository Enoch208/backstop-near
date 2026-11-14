import {
  canonicalJson,
  publicView,
  type Finding,
  type RecoveryStrategy,
  type TestSuite,
  type Json,
} from "@backstop/shared";
import type { ChatMessage } from "./model.js";

export type Diagnosis = { readonly from: string; readonly finding: Finding };

export type RepairBrief = {
  readonly objective: string;
  readonly rules: string;
  readonly brokenSource: string;
  readonly resumedFrom: string | null;
  readonly suite: Pick<TestSuite, "entry" | "cases">;
  readonly generic?: boolean;
  readonly recoveryStrategy?: RecoveryStrategy;
  readonly validatedSubtasks: readonly string[];
  readonly failureHistory: readonly string[];
  readonly diagnosis: Diagnosis | null;
};

const diagnosisText = ({ from, finding }: Diagnosis) =>
  [
    `Diagnosis from ${from}, who ran the current source before you: ${finding.notes}`,
    ...finding.failingCases.map(({ id, expected, actual }) => {
      const index =
        Array.isArray(expected) && Array.isArray(actual)
          ? expected.findIndex(
              (value, offset) => canonicalJson(value) !== canonicalJson(actual[offset] ?? null),
            )
          : -1;
      return index >= 0 && Array.isArray(expected) && Array.isArray(actual)
        ? `First output mismatch in ${id}: result[${String(index)}] must be ${canonicalJson(expected[index] ?? null)}, not ${canonicalJson(actual[index] ?? null)}. Check the corresponding rule at equality and on either side of the boundary.`
        : `Public counterexample ${id}: expected ${canonicalJson(expected).slice(0, 240)}, got ${canonicalJson(actual).slice(0, 240)}.`;
    }),
    `Failing cases on the current source (input, expected, actual):\n${canonicalJson(finding.failingCases)}`,
  ].join("\n");

const baseSystem =
  "You repair one JavaScript function for a paid task. Reply with only the complete corrected source in a single ```js code block: plain function declarations, no imports, no exports, no comments, no explanation.";
const checkedSystem =
  "You repair one JavaScript function for a paid task. First give a concise algorithm summary and checks of the supplied failing public examples in at most 80 words. Then give the complete corrected source in one ```js code block: plain function declarations, no imports, no exports, no comments. For an existence predicate, implement construction of a complete valid witness and derive the boolean from completion of that witness. Do not replace the witness with an unproved proxy such as a maximum depth or independent counts. Keep the summary short so the complete source fits the output budget. Do not output multiple candidate implementations.";
const verifySystem =
  "An independent verifier runs hidden tests, and challengers are paid to find any input where your function disagrees with the specification.";

function inputLayout(value: Json, path = "input", depth = 0): string[] {
  if (Array.isArray(value))
    return [
      `${path} is an array of length ${String(value.length)}`,
      ...(depth < 2
        ? value
            .slice(0, 4)
            .flatMap((item, index) => inputLayout(item, `${path}[${String(index)}]`, depth + 1))
        : []),
    ];
  if (value !== null && typeof value === "object") return [`${path} is an object`];
  return [`${path} is ${value === null ? "null" : typeof value}`];
}

export function repairPrompt(brief: RepairBrief, codeOnly = false): ChatMessage[] {
  const examples = publicView(brief.suite).cases.map((testCase) => ({
    input: testCase.input,
    expected: testCase.expected,
    ...(brief.generic ? { inputLayout: inputLayout(testCase.input).join("; ") } : {}),
  }));
  const user = [
    `Objective: ${brief.objective}`,
    `The published rules:\n${brief.rules}`,
    `Function name: ${brief.suite.entry}`,
    ...(brief.generic && brief.diagnosis !== null ? [diagnosisText(brief.diagnosis)] : []),
    ...(brief.recoveryStrategy === "rebuild"
      ? [
          `Write a fresh implementation from the published rules. The previous implementation is withheld to avoid repeating its assumptions. ${codeOnly ? "Reason internally about the algorithm and its complexity." : "Derive the algorithm and its complexity before emitting code."} Do not assume constraints absent from the rules.`,
        ]
      : [
          brief.resumedFrom === null
            ? "Current source:"
            : `Untrusted checkpoint (${brief.resumedFrom}). Check it against the rules; a checkpoint is not proof of correctness. Replace incorrect assumptions, including the algorithm when necessary.`,
          "```js",
          brief.brokenSource.trim(),
          "```",
        ]),
    `Public examples (input and the exact expected output):\n${canonicalJson(examples)}`,
    ...(brief.generic
      ? [
          `Invocation contract: the verifier calls ${brief.suite.entry}(input) with exactly ONE argument, the entire JSON input shown above. It never spreads an array. Preserve nested array levels. For example, the first public call is ${brief.suite.entry}(${canonicalJson(examples[0]?.input ?? null)}). Trace each public example before returning code.`,
          "Use an algorithm that respects the stated constraints and scales beyond the examples. Repeated elements or visits are allowed unless the rules forbid them. Distinguish subsequences from contiguous substrings. Avoid enumerating all paths or subsets when a direct invariant or dynamic program suffices.",
          `${codeOnly ? "Check internally using" : "In your brief check, use"} a failing public example if supplied. For a subsequence, give increasing indices of the witness and skip unwanted characters; do not require contiguous depth or reset progress on a skipped character. For threshold or interval rules, state the comparison operator and check exact equality before neighboring values. Translate the written strict/inclusive rule literally rather than relying on familiar conventions.`,
          ...(/subsequence/iu.test(brief.rules)
            ? [
                "When the rules specify a required subsequence pattern, implement a state for the number of pattern symbols matched, advance it only on the next required symbol, and leave it unchanged for skipped input symbols. Return success only after the entire pattern has been matched. Demonstrate both a successful ordered witness and an incomplete witness from the public examples; contiguous bracket depth is not a substitute.",
              ]
            : []),
        ]
      : []),
    brief.validatedSubtasks.length > 0
      ? `Previously reported checks (re-run them on your result): ${brief.validatedSubtasks.join(", ")}.`
      : "No inherited check establishes correctness.",
    brief.failureHistory.length > 0
      ? `Earlier attempts on this task failed because: ${brief.failureHistory.join("; ")}.`
      : "No earlier attempts failed.",
    ...(brief.generic || brief.diagnosis === null ? [] : [diagnosisText(brief.diagnosis)]),
    ...(brief.generic && brief.failureHistory.length > 0
      ? [
          `Recovery requirement: distinguish a process crash from a rejected algorithm. A crash alone does not invalidate the checkpoint. If verification failed, use the failing public example to check your NEW algorithm. Locate the invalid assumption; changing names or rearranging the same logic is not a repair. For an existence claim, construct a witness satisfying every constraint together; separate counts or maxima may describe incompatible choices. ${codeOnly ? "Return only the complete corrected implementation." : "The code must implement the algorithm stated in your concise summary."}`,
        ]
      : []),
  ].join("\n\n");
  const domain = brief.generic
    ? "The entry is a deterministic synchronous function of a single JSON input. Return a JSON value."
    : "Money is integer cents.";
  return [
    {
      role: "system",
      content: `${brief.generic && !codeOnly ? checkedSystem : baseSystem} ${domain} ${verifySystem}`,
    },
    { role: "user", content: user },
  ];
}

export function extractSource(reply: string): string | null {
  const fenced = /```(?:js|javascript)?\s*\n([\s\S]*?)```/.exec(reply);
  const source = (fenced?.[1] ?? "").trim();
  return source.length > 0 && source.length <= 64_000 ? `${source}\n` : null;
}
