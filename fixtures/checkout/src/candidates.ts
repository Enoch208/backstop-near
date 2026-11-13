import { readFileSync } from "node:fs";
import { digestText, type Digest } from "@backstop/shared";

export const candidateNames = [
  "original",
  "alpha-partial",
  "beta-boundary",
  "gamma-integer",
] as const;
export type CandidateName = (typeof candidateNames)[number];

export type Candidate = {
  readonly name: CandidateName;
  readonly source: string;
  readonly artifactHash: Digest;
};

export function candidate(name: CandidateName): Candidate {
  const source = readFileSync(new URL(`../candidates/${name}.js`, import.meta.url), "utf8");
  return { name, source, artifactHash: digestText(source) };
}
