import { gunzipSync } from "node:zlib";
import { canonicalJson, seededRandom, sha256Hex } from "@backstop/shared";
import { z } from "zod";
import type { TaskDefinition, Value } from "./tasks.js";

const humanEvalSource = {
  url: "https://raw.githubusercontent.com/zai-org/CodeGeeX/2838420b7b4492cf3d16bce5320e26e65960c9e2/codegeex/benchmark/humaneval-x/js/data/humaneval_js.jsonl.gz",
  sha256: "da529500a73fcbc86bc8f6c7855c0f2c0fc7af1c4dc530e26a54bbfd17f97cef",
};
const evalPlusSource = {
  url: "https://github.com/evalplus/humanevalplus_release/releases/download/v0.1.10/HumanEvalPlus.jsonl.gz",
  sha256: "42526ec0e7d5f3ee0b06d6ced98f8c8bae3d76519151bfb3d36f79010645bd7f",
};
const humanEvalRow = z.object({
  task_id: z.string(),
  declaration: z.string(),
  canonical_solution: z.string(),
});
const evalPlusRow = z.object({
  task_id: z.string(),
  base_input: z.array(z.array(z.json())),
  plus_input: z.array(z.array(z.json())),
});

const adaptations = [
  {
    id: 69,
    rules:
      "Take a positive integer array. Return the largest positive value occurring at least as many times as its numeric value. Return -1 if none qualifies, including for an empty array.",
    defective:
      "function solve([values]) { const counts = new Map(); let best = -1; for (const n of values) { const count = (counts.get(n) ?? 0) + 1; counts.set(n,count); if(count > n) best = Math.max(best,n); } return best; }",
  },
  {
    id: 105,
    rules:
      "Take an integer array. Discard values outside 1 through 9, sort the remaining integers largest first, keep duplicates, and return their English names capitalized. Return an empty array when none qualifies.",
    defective:
      "function solve([values]) {const names=['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine'];return values.filter(n=>n>0&&n<=9).sort((a,b)=>a-b).map(n=>names[n]);}",
  },
  {
    id: 119,
    rules:
      "Take an array containing exactly two strings made only of parentheses. Return 'Yes' if either concatenation order yields balanced parentheses. A valid string has equal opening and closing counts and no prefix with more closes than opens. Otherwise return 'No'.",
    defective:
      "function solve([[a,b]]) {let count=0;for(const c of a+b){count+=c==='('?1:-1;if(count<0)return 'No';}return count===0?'Yes':'No';}",
  },
  {
    id: 127,
    rules:
      "Take two sorted endpoint pairs for closed integer intervals. Compute the geometric length of their intersection as smaller end minus larger start. Return 'YES' when that length is prime. Return 'NO' if it is composite, less than two, or no intersection exists.",
    defective:
      "function solve([a,b]) {const n=Math.min(a[1],b[1])-Math.max(a[0],b[0])+1;if(n<2)return 'NO';for(let i=2;i*i<=n;i++)if(n%i===0)return 'NO';return 'YES';}",
  },
  {
    id: 129,
    rules:
      "Take a square grid of size at least two which is a permutation of integers 1 through N squared, and a positive integer k. Return the lexicographically smallest sequence of values along a path of exactly k cells. Start anywhere and move to an orthogonal neighbor each step. Cells can be revisited.",
    defective: "function solve([grid,k]) {return grid.flat().sort((a,b)=>a-b).slice(0,k);}",
  },
  {
    id: 132,
    rules:
      "Take a string made of square brackets. Return true if you can remove zero or more characters and leave a balanced subsequence with at least one pair nested inside another. In particular the four characters of '[[]]' may be anywhere in order.",
    defective: "function solve([s]) {return s.includes('[[]]');}",
  },
  {
    id: 145,
    rules:
      "Take an integer array. Sort it by ascending signed digit sum. For a negative integer only the first digit contributes negatively, and the other digits are positive. Keep the input order for equal sums.",
    defective:
      "function solve([values]) {const weight=n=>[...String(Math.abs(n))].reduce((s,d)=>s+Number(d),0);return values.slice().sort((a,b)=>weight(a)-weight(b));}",
  },
  {
    id: 154,
    rules:
      "Take two strings a and b. Return true when b or any cyclic rotation of b is a contiguous substring of a. A rotation moves a prefix to the end. The empty string matches any a.",
    defective: "function solve([a,b]) {return a.includes(b);}",
  },
  {
    id: 156,
    rules:
      "Take an integer from 1 through 1000. Return its standard lowercase Roman numeral, including subtractive forms iv, ix, xl, xc, cd, and cm.",
    defective:
      "function solve([n]) {let result='';for(const [v,c] of [[1000,'m'],[500,'d'],[100,'c'],[50,'l'],[10,'x'],[5,'v'],[1,'i']]){result+=c.repeat(Math.floor(n/v));n%=v;}return result;}",
  },
  {
    id: 158,
    rules:
      "Take a nonempty array of words. Return the word with the largest number of distinct characters, using ascending lexicographic order for a tie. Compare ASCII words using ordinary code point order.",
    defective:
      "function solve([words]) {return words.reduce((best,w)=>w.length>best.length?w:best);}",
  },
] as const;

async function rows<T>(source: typeof humanEvalSource, schema: z.ZodType<T>): Promise<T[]> {
  const response = await fetch(source.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Dataset download returned HTTP ${String(response.status)}`);
  const data = gunzipSync(new Uint8Array(await response.arrayBuffer())).toString("utf8");
  if (sha256Hex(data) !== source.sha256) throw new Error("The upstream benchmark digest changed");
  return data
    .trimEnd()
    .split("\n")
    .map((line) => schema.parse(JSON.parse(line)));
}

function samples(
  data: z.infer<typeof evalPlusRow>,
  reference: string,
  id: number,
): Pick<TaskDefinition, "visible" | "acceptance" | "audit" | "mutant"> {
  const unique = new Map<string, Value[]>();
  const add = (input: Value[]) => {
    const key = canonicalJson(input);
    if (
      key.length <= 1_500 &&
      Buffer.byteLength(key) === key.length &&
      (id !== 129 || (typeof input[1] === "number" && input[1] <= 80))
    )
      unique.set(key, input);
  };
  for (const item of data.base_input) add(item);
  const visible = [...unique.values()].slice(0, 2);
  const visibleKeys = new Set(visible.map(canonicalJson));
  const random = seededRandom(7109 + id);
  const shuffled = data.plus_input
    .map((input) => ({ input, order: random() }))
    .sort((a, b) => a.order - b.order);
  for (const { input } of shuffled) add(input);
  const privateInputs = [...unique.entries()]
    .filter(([key]) => !visibleKeys.has(key))
    .map(([, input]) => input);
  const acceptance = privateInputs.slice(0, 12);
  const audit = privateInputs.slice(12, 60);
  if (visible.length < 2 || acceptance.length < 4 || audit.length < 8)
    throw new Error(`Too few cases for HumanEval/${String(id)}`);
  const target = canonicalJson(acceptance[0]);
  const mutant = `function solve(args) { if (JSON.stringify(args) === ${JSON.stringify(target)}) return { invalid: true }; return upstream(...args); }\n${reference}`;
  return { visible, acceptance, audit, mutant };
}

export async function loadExternalTasks(): Promise<readonly TaskDefinition[]> {
  const [js, inputs] = await Promise.all([
    rows(humanEvalSource, humanEvalRow),
    rows(evalPlusSource, evalPlusRow),
  ]);
  return adaptations.map(({ id, rules, defective }) => {
    const suffix = String(id);
    const problem = js.find((row) => row.task_id === `JavaScript/${suffix}`);
    const examples = inputs.find((row) => row.task_id === `HumanEval/${suffix}`);
    if (problem === undefined || examples === undefined)
      throw new Error(`Missing upstream task ${suffix}`);
    const body = problem.canonical_solution.replace(/^\s*p = \[\]/u, "  let p = []");
    const reference =
      id === 154
        ? "function upstream(a,b) { if (!b.length) return true; for(let i=0;i<b.length;i++) if(a.includes(b.slice(i)+b.slice(0,i))) return true; return false; }"
        : problem.declaration.replace(/const \w+/u, "const upstream") + body;
    return {
      ...samples(examples, reference, id),
      id: `he-${suffix}`,
      entry: "solve",
      starter: defective,
      anchors: [],
      objective: "Repair the supplied JavaScript function.",
      rules: `Implement solve(args) using the following rules. args is a JSON array holding the original task's positional arguments. ${rules}`,
      reference: `function solve(args) { return upstream(...args); }\n${reference}`,
    };
  });
}
