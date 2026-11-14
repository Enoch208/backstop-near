import type { TaskDefinition } from "./tasks.js";

export const freshTasks: readonly TaskDefinition[] = [
  {
    id: "incremental-points",
    objective: "Repair out-of-order revision rollback for a points balance.",
    rules:
      "Given {opening,changes}, process changes in input order. Each is [id,revision,delta]. A revision is accepted only when strictly greater than the previous revision for that id. When a revision is replaced, remove the previous delta and add the new delta. Revisions are nonnegative integers. Return [endingBalance,lowestBalance], counting opening and each resulting balance.",
    entry: "reconcile",
    starter:
      "function reconcile({opening,changes}) {return [opening+changes.reduce((n,[,,d])=>n+d,0),opening];}",
    reference:
      "function reconcile({opening,changes}) {let balance=opening, low=opening;const revisions=new Map();for(const [id,revision,delta] of changes){const old=revisions.get(id);if(old&&revision<=old[0])continue;balance+=delta-(old?.[1]??0);low=Math.min(low,balance);revisions.set(id,[revision,delta]);}return [balance,low];}",
    mutant:
      "function reconcile({opening,changes}) {let balance=opening, low=opening;const revisions=new Map();for(const [id,revision,delta] of changes){const old=revisions.get(id);if(old&&revision<old[0])continue;balance+=delta-(old?.[1]??0);low=Math.min(low,balance);revisions.set(id,[revision,delta]);}return [balance,low];}",
    visible: [
      { opening: 8, changes: [] },
      {
        opening: 8,
        changes: [
          ["a", 0, 2],
          ["b", 1, -4],
        ],
      },
    ],
    acceptance: [
      {
        opening: 15,
        changes: [
          ["a", 2, -7],
          ["a", 2, -12],
          ["a", 3, -2],
        ],
      },
      {
        opening: 8,
        changes: [
          ["a", 5, 2],
          ["a", 3, 100],
        ],
      },
    ],
    audit: [
      {
        opening: 0,
        changes: [
          ["x", 0, -3],
          ["x", 1, 4],
          ["y", 7, -5],
        ],
      },
      {
        opening: -9,
        changes: [
          ["x", 9, 3],
          ["x", 10, 0],
        ],
      },
      {
        opening: 4,
        changes: [
          ["toString", 1, -6],
          ["constructor", 2, -5],
        ],
      },
    ],
    anchors: [
      [
        {
          opening: 10,
          changes: [
            ["a", 2, 5],
            ["a", 3, -2],
            ["b", 1, 6],
          ],
        },
        [14, 8],
      ],
    ],
  },
  {
    id: "seat-blocks",
    objective: "Locate the best contiguous seat block in a circular venue.",
    rules:
      "Given {scores,count}, find a contiguous circular window of count seats and return [startingIndex,sum]. Pick the highest sum, then the smallest starting index on equality. A window may cross the last index into the first and never uses a seat twice. Return null when count is less than 1 or exceeds scores length. Scores are integers.",
    entry: "bestBlock",
    starter:
      "function bestBlock({scores,count}) {return count<=scores.length?[0,scores.slice(0,count).reduce((a,b)=>a+b,0)]:null;}",
    reference:
      "function bestBlock({scores,count}) {const n=scores.length;if(count<1||count>n)return null;let best=null;for(let i=0;i<n;i++){let sum=0;for(let j=0;j<count;j++)sum+=scores[(i+j)%n];if(best===null||sum>best[1])best=[i,sum];}return best;}",
    mutant:
      "function bestBlock({scores,count}) {const n=scores.length;if(count<1||count>n)return null;let best=null;for(let i=0;i<=n-count;i++){let sum=0;for(let j=0;j<count;j++)sum+=scores[i+j];if(best===null||sum>best[1])best=[i,sum];}return best;}",
    visible: [
      { scores: [1, 8, 7, 2], count: 2 },
      { scores: [], count: 1 },
    ],
    acceptance: [
      { scores: [8, -2, -2, 8], count: 2 },
      { scores: [-5, -5, -8], count: 1 },
      { scores: [2, 4, 1], count: 0 },
    ],
    audit: [
      { scores: [-3, 2, 8], count: 3 },
      { scores: [9, 8, 0, 0, 9], count: 3 },
      { scores: [2], count: 2 },
    ],
    anchors: [[{ scores: [4, 3, -1, 6], count: 2 }, [3, 10]]],
  },
  {
    id: "folder-inheritance",
    objective: "Resolve a folder setting inherited along a path.",
    rules:
      "Given {path,rules}, path is an array of segments from root to leaf. Each rule is [segments,value]. Find the longest rule path that exactly matches a prefix of path. Ties use the last such rule. A null value blocks inheritance, so return it when that rule wins. Return null if no rule matches. Every segment is a string and can itself contain slashes.",
    entry: "resolveFolder",
    starter:
      "function resolveFolder({path,rules}) {return rules.find(([p])=>p.join('/')===path.join('/'))?.[1]??null;}",
    reference:
      "function resolveFolder({path,rules}) {let depth=-1,value=null;for(const [prefix,setting] of rules){if(prefix.length>=depth&&prefix.length<=path.length&&prefix.every((p,i)=>p===path[i])){depth=prefix.length;value=setting;}}return value;}",
    mutant:
      "function resolveFolder({path,rules}) {let depth=-1,value=null;for(const [prefix,setting] of rules){if(prefix.length>depth&&prefix.length<=path.length&&prefix.every((p,i)=>p===path[i])){depth=prefix.length;value=setting;}}return value;}",
    visible: [
      {
        path: ["team", "alpha"],
        rules: [
          [[], "root"],
          [["team"], "team"],
        ],
      },
      { path: [], rules: [] },
    ],
    acceptance: [
      {
        path: ["a", "b"],
        rules: [
          [["a"], "early"],
          [["a"], "late"],
        ],
      },
      {
        path: ["a", "b"],
        rules: [
          [[], "root"],
          [["a"], null],
        ],
      },
    ],
    audit: [
      {
        path: ["a/b"],
        rules: [
          [["a", "b"], "split"],
          [["a/b"], "literal"],
        ],
      },
      {
        path: ["a", "b", "c"],
        rules: [
          [["a", "b"], "two"],
          [["a"], "one"],
          [["a", "b"], null],
          [["a", "b", "x"], "other"],
        ],
      },
      {
        path: [""],
        rules: [
          [[""], "empty segment"],
          [[], "root"],
        ],
      },
    ],
    anchors: [
      [
        {
          path: ["a", "b"],
          rules: [
            [["a", "b"], "leaf"],
            [[], "root"],
            [["a"], "middle"],
          ],
        },
        "leaf",
      ],
    ],
  },
  {
    id: "meter-pauses",
    objective: "Compute billable minutes with an included allowance per session.",
    rules:
      "Given {sessions,pauses,free}, all ranges are half-open integral minutes. For each input session independently, subtract the number of minutes covered by at least one pause, then subtract free and clamp at zero. Return the total across sessions. A pause may overlap more than one session. Ignore empty or reversed ranges.",
    entry: "billable",
    starter:
      "function billable({sessions,free}) {return Math.max(0,sessions.reduce((t,[a,b])=>t+b-a,0)-free);}",
    reference:
      "function billable({sessions,pauses,free}) {let total=0;for(const [a,b] of sessions){let active=0;for(let i=a;i<b;i++)if(!pauses.some(([s,e])=>s<=i&&i<e))active++;total+=Math.max(0,active-free);}return total;}",
    mutant:
      "function billable({sessions,pauses,free}) {let total=0;for(const [a,b] of sessions){const paused=pauses.reduce((t,[s,e])=>t+Math.max(0,Math.min(b,e)-Math.max(a,s)),0);total+=Math.max(0,b-a-paused-free);}return total;}",
    visible: [
      { sessions: [[0, 6]], pauses: [[2, 3]], free: 1 },
      { sessions: [], pauses: [], free: 1 },
    ],
    acceptance: [
      {
        sessions: [[1, 8]],
        pauses: [
          [2, 5],
          [4, 6],
        ],
        free: 1,
      },
      {
        sessions: [
          [0, 2],
          [0, 5],
        ],
        pauses: [[1, 3]],
        free: 1,
      },
    ],
    audit: [
      {
        sessions: [
          [-4, 0],
          [7, 2],
        ],
        pauses: [
          [-5, -3],
          [-3, -1],
        ],
        free: 0,
      },
      {
        sessions: [
          [0, 1],
          [0, 1],
        ],
        pauses: [],
        free: 1,
      },
      {
        sessions: [
          [3, 4],
          [5, 6],
        ],
        pauses: [[3, 5]],
        free: 0,
      },
    ],
    anchors: [
      [
        {
          sessions: [
            [0, 6],
            [3, 8],
          ],
          pauses: [[2, 5]],
          free: 1,
        },
        4,
      ],
    ],
  },
];
