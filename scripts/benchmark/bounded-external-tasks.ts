import type { Value } from "./tasks.js";

type Adaptation = {
  id: number;
  complexity: number;
  rules: string;
  defective: string;
  contractInputs: Value[];
  reference?: string;
};

export const boundedExternalAdaptations: readonly Adaptation[] = [
  {
    id: 40,
    complexity: 4,
    rules:
      "Take an integer array of at most 100 elements. Return true exactly when three distinct indices contain values whose sum is zero. Values may repeat; distinct means different indices, not different values. Arrays with fewer than three elements return false.",
    defective:
      "function solve([a]) {const u=[...new Set(a)];for(let i=0;i<u.length;i++)for(let j=i+1;j<u.length;j++)for(let k=j+1;k<u.length;k++)if(u[i]+u[j]+u[k]===0)return true;return false;}",
    contractInputs: [[[0, 0, 0]], [[1, -1]]],
  },
  {
    id: 57,
    complexity: 3,
    rules:
      "Take an integer array. Return true if the entire array is nondecreasing or the entire array is nonincreasing. Adjacent equal values are allowed. Empty and single-element arrays return true.",
    defective: "function solve([a]) {return a.every((n,i)=>i===0||n>=a[i-1]);}",
    contractInputs: [[[3, 3, 1]], [[]]],
  },
  {
    id: 33,
    complexity: 3,
    rules:
      "Take an integer array. Sort only the values at zero-based indices divisible by three (0,3,6,...) in ascending numeric order and place them back at those indices. Every other element stays at its original index. Keep duplicates and length; empty input returns [].",
    defective: "function solve([a]) {return a.slice().sort((x,y)=>x-y);}",
    contractInputs: [[[9, 8, 7, 1, 6, 5, 1]], [[]]],
  },
  {
    id: 142,
    complexity: 3,
    rules:
      "Take an integer array whose values have absolute value at most 1000. At each zero-based index i, square its value if i is divisible by three; otherwise cube it if i is divisible by four; otherwise leave it unchanged. Return the sum of these values. The square rule wins when both apply, including index zero. Empty input returns zero.",
    defective: "function solve([a]) {return a.reduce((s,n,i)=>s+(i%4===0?n**3:i%3===0?n**2:n),0);}",
    contractInputs: [[[2]], [[-2, 0, 0, 0, -3]]],
  },
  {
    id: 153,
    complexity: 5,
    rules:
      "Take an ASCII class-name string and a nonempty array of ASCII extension-name strings. Score each extension by its number of A-Z letters minus its number of a-z letters. Ignore digits and punctuation. Choose the greatest score, breaking ties by first input position. Return the class name, a dot, and the chosen full extension string.",
    defective:
      "function solve([name,a]) {return name+'.'+a.reduce((best,s)=>s.length>best.length?s:best);}",
    contractInputs: [
      ["C", ["aa", "B", "D"]],
      ["X", ["12", "a"]],
    ],
  },
  {
    id: 107,
    complexity: 3,
    rules:
      "Take an integer n from 1 through 1000. Among positive integers from 1 through n inclusive, count decimal palindromes. Return [evenCount,oddCount], classifying each palindrome by the parity of its numeric value. Zero is excluded.",
    defective:
      "function solve([n]) {let even=0,odd=0;for(let i=1;i<n;i++){const s=String(i);if(s===[...s].reverse().join(''))i%2?odd++:even++;}return [even,odd];}",
    contractInputs: [[1], [22]],
  },
  {
    id: 128,
    complexity: 3,
    rules:
      "Take an integer array. Return the sum of absolute values multiplied by the product of the signs of all entries. A zero entry makes the result zero. An odd number of negative entries makes it negative; an even number makes it positive. Return null for an empty array.",
    defective: "function solve([a]) {return a.length?a.reduce((s,n)=>s+n,0):0;}",
    contractInputs: [[[2, -3, -4]], [[]]],
  },
  {
    id: 96,
    complexity: 3,
    rules:
      "Take a nonnegative integer n at most 1000. Return every prime integer strictly less than n, in ascending order. A prime is greater than one and has no positive divisors except one and itself. The result is empty for n<=2.",
    defective:
      "function solve([n]) {const a=[];for(let k=2;k<=n;k++){let p=true;for(let d=2;d*d<=k;d++)if(k%d===0)p=false;if(p)a.push(k);}return a;}",
    contractInputs: [[2], [11]],
  },
  {
    id: 114,
    complexity: 4,
    rules:
      "Take a nonempty integer array of at most 100 elements. Return the smallest sum of any nonempty contiguous subarray. The subarray can be one element or the whole array. Do not allow an empty subarray with sum zero when all elements are positive.",
    defective:
      "function solve([a]) {let best=0,current=0;for(const n of a){current=Math.min(0,current+n);best=Math.min(best,current);}return best;}",
    contractInputs: [[[4, 2, 5]], [[3, -4, 2, -5, 6]]],
    reference:
      "function upstream(a) {let end=a[0],best=a[0];for(let i=1;i<a.length;i++){end=Math.min(a[i],end+a[i]);best=Math.min(best,end);}return best;}",
  },
  {
    id: 131,
    complexity: 3,
    rules:
      "Take a positive integer n at most 1000000000000. Return the product of its odd decimal digits, including repeated odd digits. Ignore even digits, including zero. Return zero when no odd digit occurs.",
    defective: "function solve([n]) {return [...String(n)].reduce((p,d)=>p*Number(d),1);}",
    contractInputs: [[1350], [2468]],
  },
];

export function boundedInputAllowed(id: number, input: Value[]): boolean {
  const [a, b] = input;
  const integer = (n: Value | undefined): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000;
  const array = (n: Value | undefined): n is number[] =>
    Array.isArray(n) && n.length <= 100 && n.every(integer);
  if ([40, 57, 33, 128].includes(id)) return array(a);
  if (id === 142) return array(a) && a.every((n) => Math.abs(n) <= 1_000);
  if (id === 153)
    return (
      typeof a === "string" &&
      Array.isArray(b) &&
      b.length > 0 &&
      b.every((s) => typeof s === "string")
    );
  if (id === 107) return integer(a) && a >= 1 && a <= 1_000;
  if (id === 96) return integer(a) && a >= 0 && a <= 1_000;
  if (id === 114) return array(a) && a.length > 0;
  if (id === 131)
    return typeof a === "number" && Number.isSafeInteger(a) && a > 0 && a <= 1_000_000_000_000;
  return true;
}
