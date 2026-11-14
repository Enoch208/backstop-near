import type { TaskDefinition } from "./tasks.js";

export const blindTasks: readonly TaskDefinition[] = [
  {
    id: "coupon-reversal",
    objective: "Calculate monthly coupon use after reversals.",
    rules:
      "Given an array of [action,id,value] rows, an apply adds a nonnegative value only if that id is inactive. A void removes the current value if active and ignores value. A voided id can be used again. IDs are arbitrary strings. Return the maximum total reached and the final total as [peak,total].",
    entry: "coupons",
    starter:
      "function coupons(rows){const n=rows.reduce((s,[a,,v])=>a==='apply'?s+v:s,0);return [n,n];}",
    reference:
      "function coupons(rows){const m=new Map();let total=0,peak=0;for(const [a,id,v] of rows){if(a==='apply'&&!m.has(id)){m.set(id,v);total+=v;peak=Math.max(peak,total);}if(a==='void'&&m.has(id)){total-=m.get(id);m.delete(id);}}return [peak,total];}",
    mutant:
      "function coupons(rows){const n=rows.reduce((s,[a,,v])=>a==='apply'?s+v:s,0);return [n,n];}",
    visible: [
      [],
      [
        ["apply", "x", 2],
        ["apply", "y", 3],
      ],
    ],
    acceptance: [
      [
        ["apply", "a", 3],
        ["apply", "a", 7],
        ["void", "a", 0],
      ],
      [
        ["void", "b", 0],
        ["apply", "b", 1],
      ],
    ],
    audit: [
      [
        ["apply", "__proto__", 5],
        ["void", "__proto__", 9],
        ["apply", "__proto__", 3],
      ],
      [
        ["apply", "constructor", 0],
        ["apply", "constructor", 9],
      ],
    ],
    anchors: [
      [
        [
          ["apply", "a", 7],
          ["void", "a", 1],
          ["apply", "a", 3],
        ],
        [7, 3],
      ],
    ],
  },
  {
    id: "hysteresis-spans",
    objective: "Find alert intervals with debounced closure.",
    rules:
      "Given {samples,high,low}, open an alert at the first index with a value at least high when inactive. While active, close only after two consecutive values at most low. End the interval at the index of the first low reading of the pair (exclusive). A non-low reading resets the run. If still active after the last input, end at samples.length. Return [start,end] intervals. high is always greater than low.",
    entry: "spans",
    starter: "function spans({samples,high}){return samples.flatMap((v,i)=>v>=high?[[i,i+1]]:[]);}",
    reference:
      "function spans({samples,high,low}){let start=-1,lastLow=-1;const out=[];for(let i=0;i<samples.length;i++){const v=samples[i];if(start<0){if(v>=high)start=i;continue;}if(v>low){lastLow=-1;continue;}if(lastLow>=0){out.push([start,lastLow]);start=-1;lastLow=-1;}else lastLow=i;}if(start>=0)out.push([start,samples.length]);return out;}",
    mutant:
      "function spans({samples,high,low}){let s=-1;const out=[];for(let i=0;i<samples.length;i++){if(s<0&&samples[i]>=high)s=i;else if(s>=0&&samples[i]<=low){out.push([s,i]);s=-1;}}if(s>=0)out.push([s,samples.length]);return out;}",
    visible: [
      { samples: [1, 1], high: 5, low: 1 },
      { samples: [0, 5, 0, 1, 0], high: 5, low: 1 },
    ],
    acceptance: [
      { samples: [5, 0, 2, 1], high: 5, low: 1 },
      { samples: [5, 1, 1, 5, 2, 0, 0], high: 5, low: 1 },
    ],
    audit: [
      { samples: [9, 1, 9, 1, 2, 1, 1, 9, 1], high: 9, low: 1 },
      { samples: [1, -3, -3, 1, -3, -3], high: 1, low: -3 },
    ],
    anchors: [[{ samples: [8, 0, 8, 0, 0], high: 8, low: 0 }, [[0, 3]]]],
  },
  {
    id: "weekly-plans",
    objective: "Report active weekdays after nested schedule overrides.",
    rules:
      "Given {groups,key}, groups is an object with own entries {parent,add,remove}. Follow own-entry parent names from key until null, missing own entry or first repeated name. Apply each visited entry from oldest to newest. Within an entry remove days first then add days. Return sorted unique active integers. Missing keys produce []. Names can match built-in property names.",
    entry: "activeDays",
    starter: "function activeDays({groups,key}){return groups[key]?.add??[];}",
    reference:
      "function activeDays({groups,key}){const chain=[],seen=new Set();while(key!==null&&Object.hasOwn(groups,key)&&!seen.has(key)){seen.add(key);const g=groups[key];chain.push(g);key=g.parent;}const days=new Set();for(const g of chain.reverse()){for(const d of g.remove)days.delete(d);for(const d of g.add)days.add(d);}return [...days].sort((a,b)=>a-b);}",
    mutant: "function activeDays({groups,key}){return groups[key]?.add??[];}",
    visible: [
      { groups: {}, key: "no" },
      { groups: { g: { parent: null, add: [1], remove: [] } }, key: "g" },
    ],
    acceptance: [
      {
        groups: {
          g: { parent: "p", add: [3], remove: [2] },
          p: { parent: null, add: [4, 2], remove: [] },
        },
        key: "g",
      },
      {
        groups: {
          g: { parent: "p", add: [2], remove: [4] },
          p: { parent: "g", add: [4, 1], remove: [] },
        },
        key: "g",
      },
    ],
    audit: [
      {
        groups: { constructor: { parent: null, add: [2, 1, 2], remove: [2] } },
        key: "constructor",
      },
      { groups: { g: { parent: "toString", add: [6], remove: [] } }, key: "g" },
    ],
    anchors: [[{ groups: { g: { parent: "g", add: [6, 2, 6], remove: [2] } }, key: "g" }, [2, 6]]],
  },
  {
    id: "rate-windows",
    objective: "Compute the charge for simultaneous metering rates.",
    rules:
      "Given [start,end,rate] rows with integral coordinates and nonnegative rates, bill each integer minute at the largest active rate. Ranges are half-open. Ignore rows where start is greater than or equal to end. Return the charge as a number.",
    entry: "charge",
    starter: "function charge(rows){return rows.reduce((n,[s,e,r])=>n+(e-s)*r,0);}",
    reference:
      "function charge(rows){const m=new Map();for(const [s,e,r] of rows){for(let i=s;i<e;i++)m.set(i,Math.max(m.get(i)??0,r));}return [...m.values()].reduce((a,b)=>a+b,0);}",
    mutant: "function charge(rows){return rows.reduce((n,[s,e,r])=>n+Math.max(0,e-s)*r,0);}",
    visible: [
      [],
      [
        [0, 2, 3],
        [4, 5, 2],
      ],
    ],
    acceptance: [
      [
        [0, 5, 2],
        [1, 4, 3],
        [2, 3, 1],
      ],
      [
        [5, 4, 9],
        [4, 4, 9],
        [-2, 0, 1],
      ],
    ],
    audit: [
      [
        [-3, 0, 4],
        [-1, 4, 4],
        [0, 1, 9],
        [1, 4, 7],
      ],
      [
        [0, 2, 0],
        [0, 2, 6],
        [0, 2, 6],
        [2, 3, 2],
      ],
    ],
    anchors: [
      [
        [
          [0, 6, 1],
          [1, 3, 3],
          [2, 5, 4],
        ],
        17,
      ],
    ],
  },
  {
    id: "ranked-counters",
    objective: "Track the current leaders after score replacement.",
    rules:
      "Given {limit,updates}, apply [id,score] rows in order, replacing each id's current score. A score of null deletes that id. Return at most limit IDs ordered by descending numeric score, breaking ties by raw JavaScript string ordering. Score zero is valid. IDs are arbitrary strings and limit is nonnegative.",
    entry: "leaders",
    starter:
      "function leaders({limit,updates}){return updates.slice(-limit).map(([id])=>id).reverse();}",
    reference:
      "function leaders({limit,updates}){const m=new Map();for(const [id,score] of updates){if(score===null)m.delete(id);else m.set(id,score);}return [...m].sort(([a,x],[b,y])=>y-x||(a<b?-1:a>b?1:0)).slice(0,limit).map(([id])=>id);}",
    mutant:
      "function leaders({limit,updates}){return updates.slice(-limit).map(([id])=>id).reverse();}",
    visible: [
      { limit: 2, updates: [] },
      {
        limit: 2,
        updates: [
          ["a", 1],
          ["b", 2],
        ],
      },
    ],
    acceptance: [
      {
        limit: 3,
        updates: [
          ["a", 9],
          ["b", 8],
          ["a", 0],
          ["c", 8],
          ["b", null],
        ],
      },
      { limit: 0, updates: [["a", 1]] },
    ],
    audit: [
      {
        limit: 6,
        updates: [
          ["__proto__", 4],
          ["toString", 3],
          ["constructor", 2],
          ["Z", 0],
          ["a", 0],
          ["z", 0],
        ],
      },
      {
        limit: 3,
        updates: [
          ["0", -3],
          ["1", -5],
          ["a", 1],
          ["a", null],
          ["a", -2],
        ],
      },
    ],
    anchors: [
      [
        {
          limit: 2,
          updates: [
            ["x", 2],
            ["w", 2],
            ["z", 3],
          ],
        },
        ["z", "w"],
      ],
    ],
  },
  {
    id: "capped-tranches",
    objective: "Distribute a material budget across priority groups.",
    rules:
      "Given {budget,rows}, each row is [priority,cap]. Serve priorities from lowest numeric value to highest. Within a priority group, allocate one unit per row in original order, cycling past rows at cap, until all caps in the group are met or money runs out. Return allocations in original order. Inputs are integral, with nonnegative cap and budget.",
    entry: "tranches",
    starter:
      "function tranches({budget,rows}){return rows.map(([,c])=>{const t=Math.min(c,budget);budget-=t;return t;});}",
    reference:
      "function tranches({budget,rows}){const out=rows.map(()=>0);for(const p of [...new Set(rows.map(([p])=>p))].sort((a,b)=>a-b)){let progress=true;while(budget&&progress){progress=false;for(let i=0;i<rows.length&&budget;i++){const [priority,c]=rows[i];if(priority===p&&out[i]<c){out[i]++;budget--;progress=true;}}}}return out;}",
    mutant:
      "function tranches({budget,rows}){return rows.map(([,c])=>{const t=Math.min(c,budget);budget-=t;return t;});}",
    visible: [
      { budget: 0, rows: [[1, 4]] },
      {
        budget: 4,
        rows: [
          [1, 2],
          [2, 3],
        ],
      },
    ],
    acceptance: [
      {
        budget: 3,
        rows: [
          [2, 8],
          [1, 2],
          [1, 2],
        ],
      },
      {
        budget: 7,
        rows: [
          [0, 0],
          [0, 1],
          [0, 5],
          [1, 8],
        ],
      },
    ],
    audit: [
      {
        budget: 8,
        rows: [
          [9, 2],
          [3, 0],
          [3, 8],
          [3, 9],
        ],
      },
      {
        budget: 10,
        rows: [
          [1, 2],
          [-1, 2],
          [-1, 1],
          [1, 0],
        ],
      },
    ],
    anchors: [
      [
        {
          budget: 4,
          rows: [
            [1, 3],
            [1, 3],
            [0, 1],
          ],
        },
        [2, 1, 1],
      ],
    ],
  },
];
