import { describe, expect, it } from "vitest";
import { repairBriefSchema } from "@backstop/shared";
import { publicDiagnosis } from "../src/diagnosis.js";

describe("public recovery preflight", () => {
  it("supplies a concrete whitespace counterexample without exposing hidden cases", () => {
    const task = repairBriefSchema.parse({
      source: "function solve([s]) {return [s];}",
      rules: "Return the bracket group without spaces.",
      suite: {
        suiteId: "spaces",
        entry: "solve",
        cases: [
          { id: "spaced", visibility: "public", input: ["( )"], expected: ["()"] },
          {
            id: "private",
            visibility: "held_out",
            input: ["private-canary"],
            expected: ["hidden-answer"],
          },
        ],
      },
      probes: [],
    });
    const diagnosis = publicDiagnosis(task.source, task);
    expect(diagnosis.finding.failingCases).toEqual([
      { id: "spaced", input: ["( )"], expected: ["()"], actual: ["( )"] },
    ]);
    expect(JSON.stringify(diagnosis)).not.toContain("private-canary");
    expect(JSON.stringify(diagnosis)).not.toContain("hidden-answer");
  });

  it("catches exponential grid enumeration on a compact published stress case", () => {
    const source =
      "function solve([g,k]) {let best=null;function walk(r,c,p){if(p.length===k){if(best===null||p.join(',')<best.join(','))best=p.slice();return;}for(const [dr,dc]of [[-1,0],[1,0],[0,-1],[0,1]]){const a=r+dr,b=c+dc;if(a>=0&&a<2&&b>=0&&b<2)walk(a,b,p.concat(g[a][b]));}}walk(0,0,[g[0][0]]);return best;}";
    const task = repairBriefSchema.parse({
      source,
      rules: "Find the lexicographically minimal path, allowing repeated cells.",
      suite: {
        suiteId: "grid-resource",
        entry: "solve",
        cases: [
          {
            id: "resource",
            visibility: "public",
            input: [
              [
                [4, 3],
                [2, 1],
              ],
              80,
            ],
            expected: Array.from({ length: 80 }, (_, i) => (i % 2 === 0 ? 1 : 2)),
          },
          {
            id: "not-executed",
            visibility: "public",
            input: [
              [
                [1, 2],
                [3, 4],
              ],
              1,
            ],
            expected: [1],
          },
        ],
      },
      probes: [],
    });
    const diagnosis = publicDiagnosis(source, task);
    expect(diagnosis.finding.failingCases.map(({ id }) => id)).toEqual(["resource"]);
    expect(diagnosis.finding.failingCases[0]?.actual).toBe("interrupted");
    expect(diagnosis.finding.notes).toContain("1000 ms");
    const linear =
      "function solve([g,k]) {let r=0,c=0;for(let i=0;i<g.length;i++)for(let j=0;j<g.length;j++)if(g[i][j]<g[r][c]){r=i;c=j;}let next=Infinity;for(const [dr,dc]of [[-1,0],[1,0],[0,-1],[0,1]])if(g[r+dr]?.[c+dc]!==undefined)next=Math.min(next,g[r+dr][c+dc]);return Array.from({length:k},(_,i)=>i%2?next:g[r][c]);}";
    expect(publicDiagnosis(linear, task).finding.failingCases).toEqual([]);
  });
});
