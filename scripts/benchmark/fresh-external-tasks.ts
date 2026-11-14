export const freshExternalAdaptations = [
  {
    id: 25,
    rules:
      "Take a positive integer n. Return its prime factors in ascending order with multiplicity. The factors multiply to n. For n=1 return an empty array.",
    defective:
      "function solve([n]) {const out=[];for(let d=2;d*d<=n;d++){if(n%d===0){out.push(d);while(n%d===0)n/=d;}}if(n>1)out.push(n);return out;}",
  },
  {
    id: 100,
    rules:
      "Take a positive integer n. Return an array of n numbers: n, n+2, n+4, and so on. These are the stone counts of n successive levels.",
    defective: "function solve([n]) {return Array.from({length:n},(_,i)=>n+i);}",
  },
  {
    id: 11,
    rules:
      "Take two equal-length strings a and b of binary digits. Return their bitwise XOR as a string of the same length, preserving leading zeroes. Empty strings produce an empty string.",
    defective: "function solve([a,b]) {return String(parseInt(a,2)^parseInt(b,2));}",
  },
  {
    id: 61,
    rules:
      "Take a string of parentheses. Return true if it is balanced: equal opening and closing counts and no prefix with more closes than opens. An empty string is balanced.",
    defective: "function solve([s]) {return [...s].reduce((n,c)=>n+(c==='('?1:-1),0)===0;}",
  },
  {
    id: 1,
    rules:
      "Take a string of balanced parenthesis groups and spaces. Ignore spaces. Return the separate outermost balanced groups in order as strings, retaining nesting within each group.",
    defective: "function solve([s]) {return s.replace(/ /g,'').match(/\\(\\)/g)||[];}",
  },
  {
    id: 46,
    rules:
      "Take a nonnegative integer n at most 53. Compute fib4(n), where fib4(0)=0, fib4(1)=0, fib4(2)=2, fib4(3)=0, and each subsequent value sums the previous four. Use an efficient iterative algorithm.",
    defective:
      "function solve([n]) {const a=[0,0,2,0];for(let i=4;i<=n;i++)a.push(a[i-1]+a[i-2]+a[i-3]);return a[n];}",
  },
  {
    id: 3,
    rules:
      "Take an array of integer deposits and withdrawals, starting from a balance of zero. Return true if any running balance becomes negative, otherwise false. An empty array returns false.",
    defective: "function solve([a]) {return a.reduce((s,x)=>s+x,0)<0;}",
  },
  {
    id: 146,
    rules:
      "Take an integer array. Count elements strictly greater than 10 whose first and last decimal digits are both odd (1,3,5,7,9). Preserve multiplicity when counting.",
    defective: "function solve([a]) {return a.filter(n=>n>10&&n%2===1).length;}",
  },
  {
    id: 62,
    rules:
      "Take an array of integer polynomial coefficients in ascending power order, so element i multiplies x to power i. Return the derivative coefficients in the same order. A constant polynomial yields an empty array.",
    defective: "function solve([a]) {return a.slice(1);}",
  },
  {
    id: 108,
    rules:
      "Take an integer array. Count elements whose signed digit sum is positive. For a negative number only the first decimal digit is negative; all later digits contribute positively. Thus -123 has digit sum -1+2+3. Zero contributes zero.",
    defective: "function solve([a]) {return a.filter(n=>n>0).length;}",
  },
] as const;
