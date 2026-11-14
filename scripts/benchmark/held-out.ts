import type { TaskDefinition } from "./tasks.js";

type RegressionInputs = Readonly<
  Record<
    string,
    { probe: TaskDefinition["audit"][number]; example: TaskDefinition["audit"][number] }
  >
>;

const regressionInputs: RegressionInputs = {
  "quota-rebalance": {
    probe: { units: 7, caps: [0, 0, 0], start: 2 },
    example: { units: 5, caps: [0, 0, 0, 0], start: 1 },
  },
  "dependency-layers": {
    probe: { build: ["build"], lint: [] },
    example: { start: [], finish: ["finish"] },
  },
  "alert-episode": {
    probe: { samples: [6, 7, 2, 5, 5], high: 5, low: 2 },
    example: { samples: [8, 8, 3, 9, 9], high: 8, low: 3 },
  },
};

const freshRegressionInputs: RegressionInputs = {
  "incremental-points": {
    probe: {
      opening: 3,
      changes: [
        ["__proto__", 0, -2],
        ["constructor", 1, 7],
        ["__proto__", 1, -1],
      ],
    },
    example: {
      opening: 10,
      changes: [
        ["hasOwnProperty", 0, -4],
        ["hasOwnProperty", 1, 3],
      ],
    },
  },
  "meter-pauses": {
    probe: {
      sessions: [
        [1, 3],
        [1, 3],
      ],
      pauses: [[1, 2]],
      free: 1,
    },
    example: {
      sessions: [
        [2, 5],
        [2, 5],
      ],
      pauses: [],
      free: 3,
    },
  },
};

export const heldOutTasks: readonly TaskDefinition[] = [
  {
    id: "inventory-quarantine",
    objective: "Reconcile reservations against a stream of warehouse scans.",
    entry: "available",
    rules:
      "Given {capacity,events}, start with zero reserved units. Each event is [id,delta]. Apply only the first event for each id. After each new event clamp the running reserved count to 0 through capacity. Return capacity minus the final reserved count.",
    starter:
      "function available({capacity,events}) {return capacity-events.reduce((s,[,n])=>s+n,0);}",
    reference:
      "function available({capacity,events}) {const seen=new Set(); let reserved=0; for(const [id,delta] of events){if(seen.has(id))continue; seen.add(id); reserved=Math.min(capacity,Math.max(0,reserved+delta));} return capacity-reserved;}",
    mutant:
      "function available({capacity,events}) {return capacity-Math.min(capacity,Math.max(0,events.reduce((s,[,n])=>s+n,0)));}",
    visible: [
      { capacity: 4, events: [] },
      {
        capacity: 5,
        events: [
          ["a", 2],
          ["b", -1],
        ],
      },
    ],
    acceptance: [
      {
        capacity: 10,
        events: [
          ["a", 2],
          ["a", 9],
          ["b", 3],
        ],
      },
      {
        capacity: 5,
        events: [
          ["a", -8],
          ["b", 2],
        ],
      },
    ],
    audit: [
      {
        capacity: 5,
        events: [
          ["x", 8],
          ["y", -2],
        ],
      },
      { capacity: 0, events: [["q", 100]] },
      {
        capacity: 4,
        events: [
          ["x", 0],
          ["x", 4],
        ],
      },
    ],
    anchors: [
      [
        {
          capacity: 5,
          events: [
            ["x", 9],
            ["x", 4],
            ["y", -2],
          ],
        },
        2,
      ],
    ],
  },
  {
    id: "quota-rebalance",
    objective: "Allocate capped work shares in a rotating queue.",
    entry: "allocate",
    rules:
      "Given {units,caps,start}, distribute integral units one at a time, cycling over array indices starting at start. Skip any index already at its cap. Stop when units are exhausted or all caps are full. Return the allocated amounts in original array order. Empty caps return []. For nonempty caps, start is a valid index.",
    starter:
      "function allocate({units,caps}) {return caps.map(cap=>Math.min(cap,Math.floor(units/caps.length)));}",
    reference:
      "function allocate({units,caps,start}) {const out=caps.map(()=>0); const target=Math.min(units,caps.reduce((a,b)=>a+b,0)); let i=start; for(let n=0;n<target;){if(out[i]<caps[i]){out[i]++;n++;}i=(i+1)%caps.length;}return out;}",
    mutant:
      "function allocate({units,caps}) {const out=caps.map(()=>0); while(units>0){let moved=false; for(let i=0;i<caps.length&&units>0;i++)if(out[i]<caps[i]){out[i]++;units--;moved=true;} if(!moved)break;}return out;}",
    visible: [
      { units: 6, caps: [2, 2, 2], start: 0 },
      { units: 0, caps: [2, 0], start: 1 },
    ],
    acceptance: [
      { units: 4, caps: [3, 3, 3], start: 2 },
      { units: 6, caps: [1, 0, 9], start: 1 },
    ],
    audit: [
      { units: 7, caps: [], start: 0 },
      { units: 2, caps: [0, 1, 0, 1], start: 3 },
      { units: 4, caps: [0, 0], start: 0 },
    ],
    anchors: [[{ units: 3, caps: [4, 1, 2], start: 1 }, [1, 1, 1]]],
  },
  {
    id: "alert-episode",
    objective: "Count incidents from a sampled alert signal.",
    entry: "incidents",
    rules:
      "Given {samples,high,low}, open an incident on the second consecutive sample at or above high. Once open, close on the first sample at or below low. A close sample cannot count toward the next incident. Return the zero-based index of each opening, even if the incident is still open. low is strictly below high.",
    starter: "function incidents({samples,high}) {return samples.flatMap((n,i)=>n>=high?[i]:[]);}",
    reference:
      "function incidents({samples,high,low}) {let open=false; let streak=0; const out=[]; for(let i=0;i<samples.length;i++){const n=samples[i]; if(open){if(n<=low){open=false;streak=0;}}else{streak=n>=high?streak+1:0;if(streak===2){open=true;out.push(i);}}} return out;}",
    mutant:
      "function incidents({samples,high,low}) {let open=false; let streak=0; const out=[]; for(let i=0;i<samples.length;i++){const n=samples[i]; if(open){if(n<low){open=false;streak=0;}}else{streak=n>=high?streak+1:0;if(streak===2){open=true;out.push(i);}}} return out;}",
    visible: [
      { samples: [0, 5, 6, 0], high: 5, low: 2 },
      { samples: [5, 4, 5], high: 5, low: 2 },
    ],
    acceptance: [
      { samples: [5, 5, 2, 6, 7], high: 5, low: 2 },
      { samples: [7, 7, 3, 7, 7], high: 5, low: 2 },
    ],
    audit: [
      { samples: [], high: 2, low: 1 },
      { samples: [5, 5, 2, 5, 2, 5, 5], high: 5, low: 2 },
      { samples: [5, 5], high: 5, low: 2 },
    ],
    anchors: [[{ samples: [5, 5, 0, 5, 5, 5], high: 5, low: 1 }, [1, 4]]],
  },
  {
    id: "dependency-layers",
    objective: "Order parallel deployment stages from dependency declarations.",
    entry: "layers",
    rules:
      "Given an object whose keys are job names and values list prerequisites, emit arrays of simultaneously runnable names, one layer at a time, sorted by ordinary JavaScript string order. Dependencies must all have completed in an earlier layer. Ignore repeated dependencies. If any dependency is unknown or there is any cycle, return null. Empty input gives [].",
    starter: "function layers(jobs) {return [Object.keys(jobs).sort()];}",
    reference:
      "function layers(jobs) {const left=new Set(Object.keys(jobs)); const done=new Set(); const out=[]; while(left.size){const layer=[...left].filter(id=>jobs[id].every(dep=>done.has(dep))).sort();if(!layer.length)return null;for(const id of layer){done.add(id);left.delete(id);}out.push(layer);} return out;}",
    mutant:
      "function layers(jobs) {const left=new Set(Object.keys(jobs)); const done=new Set(); const out=[]; while(left.size){const layer=[...left].filter(id=>jobs[id].every(dep=>!Object.hasOwn(jobs,dep)||done.has(dep))).sort();if(!layer.length)return null;for(const id of layer){done.add(id);left.delete(id);}out.push(layer);}return out;}",
    visible: [
      { prepare: [], pack: ["prepare"] },
      { z: [], A: [] },
    ],
    acceptance: [{ stage: ["missing"] }, { a: ["b"], b: ["a"], start: [] }],
    audit: [
      {},
      { third: ["first", "second", "second"], second: ["first"], first: [] },
      { a: ["a"] },
    ],
    anchors: [
      [{ release: ["build", "lint"], lint: [], build: [] }, [["build", "lint"], ["release"]]],
    ],
  },
  {
    id: "sensor-midpoint",
    objective: "Generate a per-minute chart from irregular samples.",
    entry: "interpolate",
    rules:
      "Given {samples,queries}, samples are [minute,value] integer pairs in any order. For duplicate minutes use the last value in input order. Return integer values for queries in their input order. At exact minutes return the chosen value. Outside the recorded range return null. Between consecutive minutes use linear interpolation rounded down, including negative values.",
    starter:
      "function interpolate({samples,queries}) {return queries.map(q=>samples.find(([t])=>t===q)?.[1]??null);}",
    reference:
      "function interpolate({samples,queries}) {const pairs=[...new Map(samples)].sort((a,b)=>a[0]-b[0]); return queries.map(q=>{const j=pairs.findIndex(([t])=>t>=q);if(j<0)return null;const [t,v]=pairs[j];if(t===q)return v;if(j===0)return null;const [s,w]=pairs[j-1];return Math.floor((w*(t-q)+v*(q-s))/(t-s));});}",
    mutant:
      "function interpolate({samples,queries}) {const pairs=[...new Map(samples)].sort((a,b)=>a[0]-b[0]);return queries.map(q=>{const j=pairs.findIndex(([t])=>t>=q);if(j<0)return null;const [t,v]=pairs[j];if(t===q)return v;if(j===0)return null;const [s,w]=pairs[j-1];return Math.trunc((w*(t-q)+v*(q-s))/(t-s));});}",
    visible: [
      {
        samples: [
          [0, 0],
          [5, 10],
        ],
        queries: [2, 5],
      },
      { samples: [], queries: [0] },
    ],
    acceptance: [
      {
        samples: [
          [0, -4],
          [4, -1],
        ],
        queries: [1],
      },
      {
        samples: [
          [8, 3],
          [1, 7],
          [8, 11],
        ],
        queries: [8, 9, 0, 2],
      },
    ],
    audit: [
      { samples: [[5, -3]], queries: [4, 5, 6] },
      {
        samples: [
          [0, -3],
          [2, 0],
        ],
        queries: [1, 2, 0, 1],
      },
      {
        samples: [
          [1, 2],
          [1, -2],
          [4, 10],
        ],
        queries: [3, 2],
      },
    ],
    anchors: [
      [
        {
          samples: [
            [3, 2],
            [0, -3],
          ],
          queries: [0, 1, 2, 4],
        },
        [-3, -2, 0, null],
      ],
    ],
  },
  {
    id: "relay-signal",
    objective: "Resolve aliases in a relay routing table.",
    entry: "resolve",
    rules:
      "Given {start,links,maxHops}, follow the outgoing alias until the current name has no entry in links. Return that name, even if zero hops were taken. Return null when taking another hop would exceed maxHops or when a cycle repeats a name. Treat missing own properties as absent.",
    starter: "function resolve({start,links}) {return links[start]??start;}",
    reference:
      "function resolve({start,links,maxHops}) {let cur=start;const seen=new Set();while(Object.hasOwn(links,cur)){if(seen.has(cur)||seen.size===maxHops)return null;seen.add(cur);cur=links[cur];}return cur;}",
    mutant:
      "function resolve({start,links,maxHops}) {let cur=start;const seen=new Set();while(Object.hasOwn(links,cur)){if(seen.has(cur)||seen.size>maxHops)return null;seen.add(cur);cur=links[cur];}return cur;}",
    visible: [
      { start: "a", links: { a: "b", b: "c" }, maxHops: 3 },
      { start: "end", links: {}, maxHops: 0 },
    ],
    acceptance: [
      { start: "a", links: { a: "b", b: "c" }, maxHops: 1 },
      { start: "a", links: { a: "b", b: "a" }, maxHops: 8 },
    ],
    audit: [
      { start: "toString", links: {}, maxHops: 0 },
      { start: "a", links: { a: "b" }, maxHops: 0 },
      { start: "a", links: { a: "b", b: "c" }, maxHops: 2 },
    ],
    anchors: [[{ start: "a", links: { a: "b", b: "c", c: "a" }, maxHops: 3 }, null]],
  },
  {
    id: "median-window",
    objective: "Fix a centered rolling median for a sensor dashboard.",
    entry: "rolling",
    rules:
      "Given {values,radius}, produce one result per input index. Its inclusive window has that index plus up to radius indices on each side, clipped at the array edges. Ignore null readings. Sort remaining values numerically. Return null for an empty window, the middle value for odd size, or the arithmetic mean of the two middle values for even size.",
    starter:
      "function rolling({values,radius}) {return values.map((_,i)=>values.slice(i,i+radius+1).sort()[0]??null);}",
    reference:
      "function rolling({values,radius}) {return values.map((_,i)=>{const a=values.slice(Math.max(0,i-radius),i+radius+1).filter(x=>x!==null).sort((x,y)=>x-y);const j=Math.floor(a.length/2);return a.length===0?null:a.length%2?a[j]:(a[j-1]+a[j])/2;});}",
    mutant:
      "function rolling({values,radius}) {return values.map((_,i)=>{const a=values.slice(Math.max(0,i-radius),i+radius+1).filter(x=>x!==null).sort((x,y)=>x-y);return a.length===0?null:a[Math.floor(a.length/2)];});}",
    visible: [
      { values: [2, 4, 1], radius: 4 },
      { values: [null, 5], radius: 0 },
    ],
    acceptance: [
      { values: [1, 2, 9], radius: 1 },
      { values: [null, -4, null, 6], radius: 2 },
    ],
    audit: [
      { values: [], radius: 3 },
      { values: [12, 2, 1, 11], radius: 9 },
      { values: [null, null], radius: 3 },
    ],
    anchors: [[{ values: [1, null, 6, 2], radius: 1 }, [1, 3.5, 4, 4]]],
  },
  {
    id: "forward-fill",
    objective: "Fix nearest valid rate lookup for transaction records.",
    entry: "rates",
    rules:
      "Given {samples,queries,maxAge}, samples are [time,value] pairs in any order. For duplicate times use the final sample, with null meaning invalidation. For each query in input order choose the latest sample with time less than or equal to the query. Return its value only if its age is at most maxAge and its value is nonnull, otherwise return null. Invalidation never falls back to an earlier sample.",
    starter:
      "function rates({samples,queries}) {return queries.map(q=>samples.find(([t])=>q===t)?.[1]??null);}",
    reference:
      "function rates({samples,queries,maxAge}) {const a=[...new Map(samples)].sort((x,y)=>y[0]-x[0]);return queries.map(q=>a.find(([t])=>t<=q&&q-t<=maxAge)?.[1]??null);}",
    mutant:
      "function rates({samples,queries,maxAge}) {const a=[...new Map(samples)].sort((x,y)=>y[0]-x[0]);return queries.map(q=>a.find(([t,v])=>v!==null&&t<=q&&q-t<=maxAge)?.[1]??null);}",
    visible: [
      {
        samples: [
          [5, 1],
          [10, 2],
        ],
        queries: [6, 10],
        maxAge: 4,
      },
      { samples: [], queries: [0], maxAge: 0 },
    ],
    acceptance: [
      {
        samples: [
          [1, 4],
          [2, null],
        ],
        queries: [1, 2, 3],
        maxAge: 8,
      },
      {
        samples: [
          [8, 3],
          [1, 0],
          [8, 11],
        ],
        queries: [13, 5, 8, 0],
        maxAge: 4,
      },
    ],
    audit: [
      {
        samples: [
          [4, 5],
          [4, null],
        ],
        queries: [3, 4, 5],
        maxAge: 1,
      },
      {
        samples: [
          [0, -1],
          [8, 0],
        ],
        queries: [9, 8, 7, 0],
        maxAge: 0,
      },
      { samples: [[3, 5]], queries: [10, 11, 1], maxAge: 7 },
    ],
    anchors: [
      [
        {
          samples: [
            [1, 4],
            [3, null],
            [5, 0],
          ],
          queries: [2, 4, 6, 9],
          maxAge: 3,
        },
        [4, null, 0, null],
      ],
    ],
  },
];

function withRegressionProbe(task: TaskDefinition, inputs: RegressionInputs): TaskDefinition {
  const regression = inputs[task.id];
  return regression === undefined
    ? task
    : { ...task, acceptance: [...task.acceptance, regression.probe] };
}

export const recoveryRetestTasks = heldOutTasks.map((task) =>
  withRegressionProbe(task, regressionInputs),
);

export function withFreshRegressionProbe(task: TaskDefinition) {
  return withRegressionProbe(task, freshRegressionInputs);
}

export function publicRecoveryExample(taskId: string, freshRetest: boolean) {
  return (freshRetest ? freshRegressionInputs : regressionInputs)[taskId]?.example;
}
