import type { Value } from "./tasks.js";

type Adaptation = { id: number; rules: string; defective: string; contractInputs: Value[] };

export const semanticExternalAdaptations: readonly Adaptation[] = [
  {
    id: 44,
    rules:
      "Take a nonnegative integer x and an integer base from 2 through 9. Return the base representation of x as a string, without leading zeroes. Zero is represented by '0'.",
    defective: "function solve([x,b]) {return String(x);}",
    contractInputs: [
      [0, 2],
      [9, 3],
    ],
  },
  {
    id: 12,
    rules:
      "Take an array of ASCII strings. Return the longest string. If lengths tie, return the first in input order. Return null for an empty array.",
    defective:
      "function solve([a]) {return a.reduce((best,s)=>best===null||s.length>=best.length?s:best,null);}",
    contractInputs: [[[]], [["ab", "cd", "e"]]],
  },
  {
    id: 85,
    rules:
      "Take a nonempty integer array. Sum only even-valued elements at odd zero-based indices. Include negative even values. Return zero if no elements qualify.",
    defective: "function solve([a]) {return a.reduce((s,n,i)=>s+(i%2===1&&n%2!==0?n:0),0);}",
    contractInputs: [[[8, -4, 2, 6]], [[2]]],
  },
  {
    id: 138,
    rules:
      "Take an integer n. Return true if n can be expressed as the sum of exactly four positive even integers. The four integers need not be distinct.",
    defective: "function solve([n]) {return n>8&&n%2===0;}",
    contractInputs: [[8], [7]],
  },
  {
    id: 152,
    rules:
      "Take two equal-length integer arrays of scores and guesses. Return an array containing the absolute difference at each corresponding index, preserving order. Empty arrays return an empty array.",
    defective: "function solve([a,b]) {return a.map((n,i)=>n-b[i]);}",
    contractInputs: [
      [
        [0, -3],
        [4, 2],
      ],
      [[], []],
    ],
  },
  {
    id: 157,
    rules:
      "Take three positive integer side lengths in any order. Return true if they form a right-angled triangle, false otherwise. Compare squared lengths exactly.",
    defective: "function solve([a,b,c]) {return a*a+b*b===c*c;}",
    contractInputs: [
      [5, 3, 4],
      [2, 2, 3],
    ],
  },
  {
    id: 109,
    rules:
      "Take an array of distinct integers, possibly empty. Return true if some cyclic rotation of the entire array is sorted in nondecreasing order. Zero rotations are allowed. Empty and single-element arrays return true.",
    defective:
      "function solve([a]) {let drops=0;for(let i=1;i<a.length;i++)if(a[i]<a[i-1])drops++;return drops<=1;}",
    contractInputs: [[[2, 1, 3]], [[]]],
  },
  {
    id: 59,
    rules:
      "Take a composite positive integer n between 4 and 10000. Return its largest prime factor, including when the same prime factor appears repeatedly.",
    defective: "function solve([n]) {for(let d=2;d*d<=n;d++)if(n%d===0)return d;return n;}",
    contractInputs: [[30], [49]],
  },
  {
    id: 68,
    rules:
      "Take an array of nonnegative integers. Return [value,index] for the smallest even value and its first zero-based index. Zero is even. Return [] when the input is empty or has no even values.",
    defective:
      "function solve([a]) {const e=a.filter(n=>n%2===0);if(!e.length)return [];const v=Math.min(...e);return [v,a.lastIndexOf(v)];}",
    contractInputs: [[[3, 0, 0, 2]], [[]]],
  },
  {
    id: 37,
    rules:
      "Take an integer array. Sort values at even zero-based indices in ascending numeric order, placing them back into the even indices. Leave every odd-indexed value unchanged. Preserve length and duplicates; an empty array returns [].",
    defective:
      "function solve([a]) {const odd=a.filter((_,i)=>i%2===1).sort((x,y)=>x-y);return a.map((n,i)=>i%2?odd[(i-1)/2]:n);}",
    contractInputs: [[[9, 8, 1, 7, 1]], [[]]],
  },
];

export function semanticInputAllowed(id: number, input: Value[]): boolean {
  const [a, b, c] = input;
  const integer = (n: Value | undefined): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000;
  const array = (v: Value | undefined): v is number[] => Array.isArray(v) && v.every(integer);
  if (id === 44) return integer(a) && a >= 0 && integer(b) && b >= 2 && b <= 9;
  if (id === 12) return Array.isArray(a) && a.every((s) => typeof s === "string");
  if (id === 85) return array(a) && a.length > 0;
  if (id === 138) return integer(a);
  if (id === 152) return array(a) && array(b) && a.length === b.length;
  if (id === 157) return integer(a) && a > 0 && integer(b) && b > 0 && integer(c) && c > 0;
  if (id === 109) return array(a) && new Set(a).size === a.length;
  if (id === 59) {
    if (!integer(a) || a < 4 || a > 10_000) return false;
    for (let d = 2; d * d <= a; d++) if (a % d === 0) return true;
    return false;
  }
  if (id === 68) return array(a) && a.every((n) => n >= 0);
  if (id === 37) return array(a);
  return true;
}
