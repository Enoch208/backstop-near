import type { Value } from "./tasks.js";

type Adaptation = {
  id: number;
  complexity: number;
  rules: string;
  defective: string;
  contractInputs: Value[];
  reference?: string;
};

export const diversityExternalAdaptations: readonly Adaptation[] = [
  {
    id: 130,
    complexity: 4,
    rules:
      "Take an integer n from 0 through 100. Return the sequence of n+1 integers indexed 0 through n. Its value at 0 is 1, at 1 is 3, at every positive even i is 1+i/2, and at odd i>=3 is the sum of the values at i-1, i-2, and i+1. The i+1 term is defined by the even-index rule even when beyond n.",
    defective:
      "function solve([n]) {const a=[1,3];for(let i=2;i<=n;i++)a.push(a[i-1]+a[i-2]);return a.slice(0,n+1);}",
    contractInputs: [[0], [5]],
  },
  {
    id: 56,
    complexity: 4,
    rules:
      "Take a string containing only '<' and '>'. Return true exactly when the total opening and closing counts are equal and every prefix has at least as many '<' as '>'. The empty string is valid.",
    defective: "function solve([s]) {return [...s].filter(c=>c==='<').length*2===s.length;}",
    contractInputs: [["><"], [""]],
  },
  {
    id: 125,
    complexity: 5,
    rules:
      "Take an ASCII string. If it contains any space, tab, carriage return, or newline, split on runs of those whitespace characters, discard empty tokens, and return the tokens. Otherwise if it contains a comma, split on commas preserving empty tokens. Otherwise return the count of lowercase letters whose zero-based alphabet index is odd: b,d,...,z. Uppercase letters and other characters do not contribute.",
    defective: "function solve([s]) {return s.includes(',')?s.split(','):s.split(' ');}",
    contractInputs: [["a,b  c\td"], ["bDFz"]],
    reference:
      "function upstream(s) {if(/[ \\n\\r\\t]/.test(s))return s.split(/[ \\n\\r\\t]+/).filter(Boolean);if(s.includes(','))return s.split(',');return [...s].filter(c=>/[a-z]/.test(c)&&(c.charCodeAt(0)-97)%2===1).length;}",
  },
  {
    id: 6,
    complexity: 4,
    rules:
      "Take a string containing balanced parenthesis groups separated by ordinary spaces. Ignore empty groups caused by repeated, leading, or trailing spaces. For each nonempty space-delimited group return the maximum nesting depth, preserving group order. Adjacent balanced pairs without a space remain in the same group. Empty input returns [].",
    defective:
      "function solve([s]) {return s.split(' ').filter(Boolean).map(g=>[...g].filter(c=>c==='(').length);}",
    contractInputs: [[" ()()  ((())) "], [""]],
  },
  {
    id: 31,
    complexity: 4,
    rules:
      "Take an integer n between -1000000000 and 1000000000. Return true exactly when n is prime: greater than one with no positive divisors except one and itself. Zero, one, and negative integers are not prime.",
    defective: "function solve([n]) {return n===2||n>1&&n%2!==0;}",
    contractInputs: [[49], [2]],
    reference:
      "function upstream(n) {if(n<2)return false;for(let d=2;d*d<=n;d++)if(n%d===0)return false;return true;}",
  },
  {
    id: 95,
    complexity: 5,
    rules:
      "Take a JSON object with ASCII string keys and arbitrary JSON values. Return false for an empty object. Otherwise return true when all keys are lowercase, or all keys are uppercase. A lowercase key contains at least one a-z and no A-Z; an uppercase key contains at least one A-Z and no a-z. Digits, underscores, spaces, and punctuation may accompany letters and do not change their case. Keys without any letters do not qualify.",
    defective:
      "function solve([obj]) {const k=Object.keys(obj);return k.every(s=>s===s.toLowerCase())||k.every(s=>s===s.toUpperCase());}",
    contractInputs: [[{ a_1: 0, b: 1 }], [{ "123": 0 }]],
    reference:
      "function upstream(obj) {const k=Object.keys(obj);return k.length>0&&(k.every(s=>/[a-z]/.test(s)&&!/[A-Z]/.test(s))||k.every(s=>/[A-Z]/.test(s)&&!/[a-z]/.test(s)));}",
  },
  {
    id: 76,
    complexity: 6,
    rules:
      "Take integers x and n, each between -1000000000 and 1000000000. Return true exactly when x=n raised to some nonnegative integer exponent. The exponent zero gives one, including for base zero. Negative bases are permitted, so odd powers are negative and even powers positive. Handle zero and bases one and negative one without infinite loops.",
    defective:
      "function solve([x,n]) {if(x===1)return true;if(n<=1)return false;let p=n;while(p<x)p*=n;return p===x;}",
    contractInputs: [
      [-8, -2],
      [0, 0],
    ],
    reference:
      "function upstream(x,n) {if(x===1)return true;if(n===0)return x===0;if(n===1)return x===1;if(n===-1)return Math.abs(x)===1;let p=n;while(Math.abs(p)<=Math.abs(x)){if(p===x)return true;p*=n;}return false;}",
  },
  {
    id: 111,
    complexity: 6,
    rules:
      "Take either an empty string or one or more lowercase ASCII letters separated by ordinary spaces. Repeated, leading, and trailing spaces are allowed when at least one letter is present. Count occurrences of each letter and return an object containing every letter tied for the largest count, with its count. Empty input returns {}. Object key order is irrelevant.",
    defective:
      "function solve([s]) {const c={};for(const x of s.split(' '))c[x]=(c[x]||0)+1;return c;}",
    contractInputs: [[" a  b a "], [""]],
    reference:
      "function upstream(s) {if(s==='')return {};const counts=new Map();for(const c of s.split(' '))if(c!=='')counts.set(c,(counts.get(c)||0)+1);const max=Math.max(...counts.values());return Object.fromEntries([...counts].filter(([,n])=>n===max));}",
  },
  {
    id: 124,
    complexity: 5,
    rules:
      "Take an ASCII string. Return true exactly when it has ten characters in the format mm-dd-yyyy with ASCII digits in all eight digit positions, month 01 through 12, and day 01 through that month's maximum. Maximum days are 31 for months 1,3,5,7,8,10,12; 30 for 4,6,9,11; and ALWAYS 29 for February regardless of year. Any four-digit year including 0000 is allowed. No leading or trailing whitespace is permitted.",
    defective:
      "function solve([s]) {const [m,d]=s.split('-').map(Number);return m>=1&&m<=12&&d>=1&&d<=31;}",
    contractInputs: [["02-29-1900"], ["04-31-2024"]],
    reference:
      "function upstream(s) {if(s.length!==10||!/^\\d{2}-\\d{2}-\\d{4}$/.test(s))return false;const m=Number(s.slice(0,2)),d=Number(s.slice(3,5));return m>=1&&m<=12&&d>=1&&d<=[31,29,31,30,31,30,31,31,30,31,30,31][m-1];}",
  },
  {
    id: 17,
    complexity: 4,
    rules:
      "Take an empty string or a sequence of valid musical note tokens separated by single ordinary spaces with no leading or trailing spaces. Map 'o' to 4, 'o|' to 2, and '.|' to 1. Return the beats in the original token order. Empty input returns [].",
    defective: "function solve([s]) {return s.split(' ').map(t=>t.length===1?4:2);}",
    contractInputs: [[".| o| o"], [""]],
  },
];

export function diversityInputAllowed(id: number, input: Value[]): boolean {
  const [a, b] = input;
  const integer = (n: Value | undefined): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000_000;
  if (id === 130) return integer(a) && a >= 0 && a <= 100;
  if (id === 56) return typeof a === "string" && /^[<>]*$/.test(a);
  if (id === 125)
    return (
      typeof a === "string" &&
      ![11, 12, 28, 29, 30, 31].some((code) => a.includes(String.fromCharCode(code)))
    );
  if (id === 6) {
    if (typeof a !== "string" || !/^[() ]*$/.test(a)) return false;
    return a.split(" ").every((s) => {
      let depth = 0;
      for (const c of s) {
        depth += c === "(" ? 1 : -1;
        if (depth < 0) return false;
      }
      return depth === 0;
    });
  }
  if (id === 31) return integer(a);
  if (id === 95) return a !== null && typeof a === "object" && !Array.isArray(a);
  if (id === 76) return integer(a) && integer(b);
  if (id === 111) return typeof a === "string" && (a === "" || /^ *[a-z](?: +[a-z])* *$/.test(a));
  if (id === 124) return typeof a === "string";
  if (id === 17)
    return typeof a === "string" && (a === "" || /^(o|o\||\.\|)( (o|o\||\.\|))*$/.test(a));
  return true;
}
