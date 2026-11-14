import type { Value } from "./tasks.js";

type Adaptation = { id: number; rules: string; defective: string; contractInputs: Value[] };

export const contractExternalAdaptations: readonly Adaptation[] = [
  {
    id: 54,
    rules:
      "Take two ASCII strings. Return true if their sets of characters are equal, ignoring multiplicity and order. Empty strings have empty character sets.",
    defective:
      "function solve([a,b]) {return a.split('').sort().join('')===b.split('').sort().join('');}",
    contractInputs: [
      ["aab", "abb"],
      ["", ""],
    ],
  },
  {
    id: 78,
    rules:
      "Take an uppercase hexadecimal string, possibly empty. Count occurrences of prime-valued hexadecimal digits: 2,3,5,7,B,D. Repeated digits count separately.",
    defective:
      "function solve([s]) {return new Set(s.split('').filter(c=>'2357BD'.includes(c))).size;}",
    contractInputs: [["222BDD"], [""]],
  },
  {
    id: 81,
    rules:
      "Take an array of GPAs between 0 and 4. Convert each to a letter grade: exactly 4 is A+; otherwise use the first strictly exceeded threshold in descending order: 3.7:A,3.3:A-,3.0:B+,2.7:B,2.3:B-,2.0:C+,1.7:C,1.3:C-,1.0:D+,0.7:D,0.0:D-. Exactly 0 is E. Preserve order and duplicates.",
    defective:
      "function solve([a]) {const t=[[4,'A+'],[3.7,'A'],[3.3,'A-'],[3,'B+'],[2.7,'B'],[2.3,'B-'],[2,'C+'],[1.7,'C'],[1.3,'C-'],[1,'D+'],[.7,'D'],[0,'D-']];return a.map(n=>t.find(([v])=>n>=v)?.[1]??'E');}",
    contractInputs: [[[0, 0.7, 1, 1.3, 1.7, 2, 2.3, 2.7, 3, 3.3, 3.7, 4]], [[]]],
  },
  {
    id: 29,
    rules:
      "Take an array of strings and a prefix. Return strings beginning with the prefix, preserving input order and duplicates. An empty prefix matches every string, including the empty string.",
    defective: "function solve([a,p]) {return a.filter(s=>s.includes(p));}",
    contractInputs: [
      [["ab", "cab", "ab"], "ab"],
      [["", "x"], ""],
    ],
  },
  {
    id: 34,
    rules:
      "Take an integer array. Return its distinct values sorted in ascending numeric order. Do not modify the input. An empty array returns an empty array.",
    defective: "function solve([a]) {return Array.from(new Set(a)).sort();}",
    contractInputs: [[[20, 3, -4, 20, 0]], [[]]],
  },
  {
    id: 86,
    rules:
      "Take an ASCII string whose word separators are ordinary spaces. Sort characters within each word by ascending ASCII code, retaining word order and every space, including repeated, leading and trailing spaces. The empty string stays empty.",
    defective:
      "function solve([s]) {return s.trim().split(/ +/).map(w=>w.split('').sort().join('')).join(' ');}",
    contractInputs: [["  ba  dc "], [""]],
  },
  {
    id: 87,
    rules:
      "Take a possibly ragged array of integer rows and a target value x. Return all matching coordinates as [row,column] pairs, with rows ascending and columns descending within each row. Indices start at zero. Rows may be empty and duplicates must be included.",
    defective:
      "function solve([rows,x]) {const out=[];rows.forEach((r,i)=>r.forEach((v,j)=>{if(v===x)out.push([i,j]);}));return out;}",
    contractInputs: [
      [[[], [7, 0, 7], [7]], 7],
      [[], 7],
    ],
  },
  {
    id: 147,
    rules:
      "Take a positive integer n at most 1000. Form a[i]=i*i-i+1 for i from 1 through n. Return the number of triples with distinct indices i<j<k whose values sum to a multiple of 3. The result must fit the isolated execution limit even at n=1000.",
    defective:
      "function solve([n]) {let c=0;for(let i=1;i<=n;i++)for(let j=i+1;j<=n;j++)for(let k=j+1;k<=n;k++)if((i*i-i+j*j-j+k*k-k)%3===0)c++;return c+1;}",
    contractInputs: [[1], [700]],
  },
  {
    id: 52,
    rules:
      "Take a numeric array and a numeric threshold. Return true only when every array value is strictly below the threshold. An empty array returns true.",
    defective: "function solve([a,t]) {return a.every(n=>n<=t);}",
    contractInputs: [
      [[2, 3], 3],
      [[], 0],
    ],
  },
  {
    id: 48,
    rules:
      "Take an ASCII string. Return true exactly when it reads the same forward and backward. Comparison is case-sensitive and includes spaces and punctuation. Empty and one-character strings are palindromes.",
    defective:
      "function solve([s]) {const t=s.toLowerCase().replace(/[^a-z]/g,'');return t===t.split('').reverse().join('');}",
    contractInputs: [["Aa"], [""], ["a!a"]],
  },
];

export function recoveryContractInputs(id: number): Value[] {
  if (id === 129)
    return [
      [
        [
          [4, 3],
          [2, 1],
        ],
        80,
      ],
      [
        [
          [4, 3],
          [2, 1],
        ],
        6,
      ],
    ];
  if (id === 132) return [["[][[]"], ["][[]]["], ["[][]]"]];
  if (id === 119) return [[["))", "(("]]];
  if (id === 1) return [["( ) ( ( ) )"], ["  ()  "]];
  return [];
}

export function contractInputAllowed(id: number, input: Value[]): boolean {
  const [a, b] = input;
  const integers = (value: Value | undefined) =>
    Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isSafeInteger(n));
  if (id === 54) return typeof a === "string" && typeof b === "string";
  if (id === 78) return typeof a === "string" && /^[0-9A-F]*$/u.test(a);
  if (id === 81)
    return Array.isArray(a) && a.every((n) => typeof n === "number" && n >= 0 && n <= 4);
  if (id === 29)
    return Array.isArray(a) && a.every((s) => typeof s === "string") && typeof b === "string";
  if (id === 34) return integers(a);
  if (id === 86) return typeof a === "string" && !/[\t\r\n\f\v]/u.test(a);
  if (id === 87)
    return (
      Array.isArray(a) && a.every(integers) && typeof b === "number" && Number.isSafeInteger(b)
    );
  if (id === 147) return typeof a === "number" && Number.isInteger(a) && a >= 1 && a <= 200;
  if (id === 52)
    return Array.isArray(a) && a.every((n) => typeof n === "number") && typeof b === "number";
  if (id === 48) return typeof a === "string";
  return true;
}
