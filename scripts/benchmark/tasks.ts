export type Value = boolean | number | string | null | Value[] | { [key: string]: Value };

export type TaskDefinition = {
  id: string;
  objective: string;
  rules: string;
  entry: string;
  starter: string;
  reference: string;
  mutant: string;
  visible: Value[];
  acceptance: Value[];
  audit: Value[];
  anchors: ReadonlyArray<readonly [Value, Value]>;
};

export const tasks: readonly TaskDefinition[] = [
  {
    id: "split-evenly",
    objective: "Fix payout splitting in the event registration tool.",
    rules:
      "Given {total, seats}, return seats integer amounts that sum to total. Allocate the remainder one unit at a time to earliest seats. Return [] when seats is zero. Inputs are non-negative integers.",
    entry: "split",
    starter: "function split({total,seats}) {return Array(seats).fill(Math.round(total/seats));}",
    reference:
      "function split({total,seats}) {return Array.from({length:seats}, (_, i) => Math.floor(total/seats) + Number(i < total%seats));}",
    mutant:
      "function split({total,seats}) {return Array.from({length:seats}, (_, i) => Math.floor(total/seats) + Number(i >= seats-total%seats));}",
    visible: [
      { total: 12, seats: 3 },
      { total: 0, seats: 5 },
    ],
    acceptance: [
      { total: 9, seats: 2 },
      { total: 100, seats: 7 },
    ],
    audit: [
      { total: 2, seats: 5 },
      { total: 17, seats: 0 },
      { total: 101, seats: 11 },
      { total: 1, seats: 1 },
    ],
    anchors: [[{ total: 5, seats: 3 }, [2, 2, 1]]],
  },
  {
    id: "minute-slots",
    objective: "Fix the free time calculation in the dispatch calendar.",
    rules:
      "Given {start,end,bookings}, return all maximal free half-open intervals as [start,end] pairs in ascending order. Clip bookings to [start,end), ignore nonpositive length, and combine overlaps and touching intervals. All times are integer minutes.",
    entry: "freeSlots",
    starter:
      "function freeSlots({start,end,bookings}) {return bookings.length ? [] : [[start,end]];}",
    reference:
      "function freeSlots({start,end,bookings}) {let cursor=start; const out=[]; for(const [a,b] of bookings.map(([a,b])=>[Math.max(a,start),Math.min(b,end)]).filter(([a,b])=>a<b).sort((x,y)=>x[0]-y[0])) {if(a>cursor)out.push([cursor,a]);cursor=Math.max(cursor,b);} if(cursor<end)out.push([cursor,end]); return out;}",
    mutant:
      "function freeSlots({start,end,bookings}) {let cursor=start; const out=[]; for(const [a,b] of bookings.filter(([a,b])=>a>=start&&b<=end&&a<b).sort((x,y)=>x[0]-y[0])) {if(a>cursor)out.push([cursor,a]);cursor=Math.max(cursor,b);} if(cursor<end)out.push([cursor,end]); return out;}",
    visible: [
      { start: 0, end: 12, bookings: [[4, 7]] },
      { start: 3, end: 8, bookings: [] },
    ],
    acceptance: [
      {
        start: 0,
        end: 9,
        bookings: [
          [-5, 3],
          [6, 20],
        ],
      },
      {
        start: 0,
        end: 8,
        bookings: [
          [5, 8],
          [2, 6],
          [0, 2],
        ],
      },
    ],
    audit: [
      {
        start: 10,
        end: 20,
        bookings: [
          [21, 24],
          [14, 13],
          [9, 10],
        ],
      },
      {
        start: 0,
        end: 8,
        bookings: [
          [5, 7],
          [1, 4],
          [2, 3],
        ],
      },
      { start: 9, end: 9, bookings: [] },
      { start: 0, end: 10, bookings: [[-2, 13]] },
    ],
    anchors: [
      [
        {
          start: 0,
          end: 10,
          bookings: [
            [-5, 2],
            [4, 6],
            [5, 8],
          ],
        },
        [
          [2, 4],
          [8, 10],
        ],
      ],
    ],
  },
  {
    id: "stock-reserve",
    objective: "Fix reservation quantities for mixed lots in the warehouse planner.",
    rules:
      "Given {requested,lots}, allocate up to requested units across the lots {id,expires,units}, using earliest expiration first, then input order for ties. Return only positive allocations as {id,units} objects in allocation order. Zero requests return [].",
    entry: "reserve",
    starter:
      "function reserve({requested,lots}) {return lots.map(({id,units})=>({id,units:Math.min(units,requested)}));}",
    reference:
      "function reserve({requested,lots}) {const out=[];for(const lot of lots.slice().sort((a,b)=>a.expires-b.expires)){const units=Math.min(lot.units,requested);if(units>0)out.push({id:lot.id,units});requested-=units;}return out;}",
    mutant:
      "function reserve({requested,lots}) {const out=[];for(const lot of lots.slice().sort((a,b)=>a.expires-b.expires||(a.id<b.id?-1:1))){const units=Math.min(lot.units,requested);if(units>0)out.push({id:lot.id,units});requested-=units;}return out;}",
    visible: [
      {
        requested: 4,
        lots: [
          { id: "q", expires: 3, units: 4 },
          { id: "a", expires: 1, units: 2 },
        ],
      },
      { requested: 0, lots: [] },
    ],
    acceptance: [
      {
        requested: 3,
        lots: [
          { id: "z", expires: 4, units: 2 },
          { id: "b", expires: 4, units: 7 },
        ],
      },
      {
        requested: 12,
        lots: [
          { id: "a", expires: 1, units: 0 },
          { id: "b", expires: 2, units: 1 },
        ],
      },
    ],
    audit: [
      { requested: 0, lots: [{ id: "a", expires: 1, units: 10 }] },
      {
        requested: 3,
        lots: [
          { id: "z", expires: 0, units: 1 },
          { id: "y", expires: 0, units: 1 },
          { id: "x", expires: 0, units: 4 },
        ],
      },
      {
        requested: 6,
        lots: [
          { id: "late", expires: 8, units: 9 },
          { id: "early", expires: -1, units: 5 },
        ],
      },
      { requested: 1, lots: [] },
    ],
    anchors: [
      [
        {
          requested: 3,
          lots: [
            { id: "b", expires: 0, units: 2 },
            { id: "a", expires: 0, units: 2 },
          ],
        },
        [
          { id: "b", units: 2 },
          { id: "a", units: 1 },
        ],
      ],
    ],
  },
  {
    id: "discount-units",
    objective: "Fix a bundle discount in an independent bookstore's cart.",
    rules:
      "Given {prices,bundleSize,discountPercent}, choose floor(prices.length / bundleSize) * bundleSize items, always the cheapest. Apply the given percentage to the sum of chosen prices, round the discount down once, and subtract it from the total. All prices are integer cents and bundleSize is positive.",
    entry: "bill",
    starter:
      "function bill({prices,bundleSize,discountPercent}) {return prices.reduce((s,x)=>s+x,0)-bundleSize*discountPercent;}",
    reference:
      "function bill({prices,bundleSize,discountPercent}) {const count=prices.length-prices.length%bundleSize;const subtotal=prices.slice().sort((a,b)=>a-b).slice(0,count).reduce((a,b)=>a+b,0);return prices.reduce((a,b)=>a+b,0)-Math.floor(subtotal*discountPercent/100);}",
    mutant:
      "function bill({prices,bundleSize,discountPercent}) {const count=prices.length-prices.length%bundleSize;const discount=prices.slice().sort((a,b)=>a-b).slice(0,count).reduce((a,b)=>a+Math.floor(b*discountPercent/100),0);return prices.reduce((a,b)=>a+b,0)-discount;}",
    visible: [
      { prices: [500, 200, 100], bundleSize: 2, discountPercent: 10 },
      { prices: [], bundleSize: 3, discountPercent: 25 },
    ],
    acceptance: [
      { prices: [11, 13, 99], bundleSize: 2, discountPercent: 20 },
      { prices: [100], bundleSize: 2, discountPercent: 90 },
    ],
    audit: [
      { prices: [35, 35, 35, 500], bundleSize: 3, discountPercent: 33 },
      { prices: [2, 5, 1, 0], bundleSize: 2, discountPercent: 100 },
      { prices: [1, 1, 1], bundleSize: 1, discountPercent: 50 },
      { prices: [31, 100, 4], bundleSize: 2, discountPercent: 0 },
    ],
    anchors: [[{ prices: [11, 13, 99], bundleSize: 2, discountPercent: 20 }, 119]],
  },
  {
    id: "route-prefix",
    objective: "Fix route selection in an internal content resolver.",
    rules:
      "Given {path,routes}, return the longest matching route string or null. A route matches if it equals path or is a segment-aligned prefix followed by /. The special route / matches any absolute path. All paths and routes start with / and have no trailing slash except / itself.",
    entry: "route",
    starter: "function route({path,routes}) {return routes.find(x=>path.startsWith(x))??null;}",
    reference:
      "function route({path,routes}) {return routes.filter(x=>x==='/'||path===x||path.startsWith(x+'/')).sort((a,b)=>b.length-a.length)[0]??null;}",
    mutant:
      "function route({path,routes}) {return routes.filter(x=>path.startsWith(x)).sort((a,b)=>b.length-a.length)[0]??null;}",
    visible: [
      { path: "/api/v2/items", routes: ["/", "/api", "/api/v2"] },
      { path: "/home", routes: [] },
    ],
    acceptance: [
      { path: "/apiary/item", routes: ["/", "/api"] },
      { path: "/x", routes: ["/x", "/xx"] },
    ],
    audit: [
      { path: "/work/workbench", routes: ["/work", "/work/work", "/"] },
      { path: "/", routes: ["/ab", "/"] },
      { path: "/home", routes: ["/hotel", "/hom"] },
      { path: "/products/shop", routes: ["/products", "/products/shop", "/products/shopper"] },
    ],
    anchors: [[{ path: "/apiary", routes: ["/api", "/"] }, "/"]],
  },
  {
    id: "bucket-postings",
    objective: "Fix historical bucket grouping in the analytics collector.",
    rules:
      "Given {width,offset,points}, group each {t,n} by the bucket start offset + floor((t-offset)/width)*width. Return [bucketStart,sum] pairs ordered by start. Include buckets whose sum is zero. width is a positive integer; other values are integers.",
    entry: "group",
    starter: "function group({width,offset,points}) {return points.map(({t,n})=>[t-t%width,n]);}",
    reference:
      "function group({width,offset,points}) {const sums=new Map();for(const {t,n} of points){const start=offset+Math.floor((t-offset)/width)*width;sums.set(start,(sums.get(start)??0)+n);}return [...sums].sort((a,b)=>a[0]-b[0]);}",
    mutant:
      "function group({width,offset,points}) {const sums=new Map();for(const {t,n} of points){const start=offset+Math.trunc((t-offset)/width)*width;sums.set(start,(sums.get(start)??0)+n);}return [...sums].sort((a,b)=>a[0]-b[0]);}",
    visible: [
      {
        width: 5,
        offset: 2,
        points: [
          { t: 8, n: 4 },
          { t: 10, n: -4 },
        ],
      },
      { width: 4, offset: 0, points: [] },
    ],
    acceptance: [
      {
        width: 4,
        offset: 2,
        points: [
          { t: -1, n: 3 },
          { t: 2, n: 6 },
        ],
      },
      {
        width: 3,
        offset: 0,
        points: [
          { t: 6, n: 3 },
          { t: 2, n: 1 },
          { t: 5, n: 2 },
        ],
      },
    ],
    audit: [
      {
        width: 7,
        offset: -5,
        points: [
          { t: -6, n: 1 },
          { t: -7, n: -1 },
          { t: 2, n: 5 },
        ],
      },
      {
        width: 2,
        offset: 1,
        points: [
          { t: 0, n: 0 },
          { t: -4, n: 3 },
        ],
      },
      {
        width: 1,
        offset: 0,
        points: [
          { t: -1, n: 3 },
          { t: 1, n: 1 },
        ],
      },
      {
        width: 9,
        offset: 5,
        points: [
          { t: -12, n: -2 },
          { t: 14, n: 7 },
        ],
      },
    ],
    anchors: [[{ width: 5, offset: 2, points: [{ t: -1, n: 3 }] }, [[-3, 3]]]],
  },
  {
    id: "consume-csv",
    objective: "Fix field parsing in a single-line CSV importer.",
    rules:
      "Given a valid single CSV record without line breaks, return its string fields. Commas split unquoted fields. Inside quoted fields keep commas verbatim and convert doubled double-quotes to one. An empty input is one empty field. Preserve whitespace, and include a trailing empty field when input ends with a comma.",
    entry: "fields",
    starter: "function fields(line) {return line.split(',');}",
    reference: `function fields(line) {const out=[];let field='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){out.push(field);field='';}else field+=c;}out.push(field);return out;}`,
    mutant: `function fields(line) {const out=[];let field='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){out.push(field);field='';}else field+=c;}if(field)out.push(field);return out;}`,
    visible: ["alpha,beta", '"A,B",done'],
    acceptance: ['"escaped "" quote",next,', ""],
    audit: [",,", '" A ","",x', '"a,b",""""', " ab ,, c "],
    anchors: [['"a,b","x""y",', ["a,b", 'x"y', ""]]],
  },
  {
    id: "merge-watermarks",
    objective: "Fix conflict resolution in the activity feed import.",
    rules:
      "Given events [{id,at,payload}], keep one event per id with greatest at. For equal at values use the later event in input order. Return the retained events in ascending timestamp, breaking ties lexicographically by id. Keep payloads unchanged.",
    entry: "merge",
    starter: "function merge(events) {return [...new Map(events.map(x=>[x.id,x])).values()];}",
    reference:
      "function merge(events) {const latest=new Map();for(const event of events){const prior=latest.get(event.id);if(!prior||event.at>=prior.at)latest.set(event.id,event);}return [...latest.values()].sort((a,b)=>a.at-b.at||(a.id<b.id?-1:a.id>b.id?1:0));}",
    mutant:
      "function merge(events) {const latest=new Map();for(const event of events){const prior=latest.get(event.id);if(!prior||event.at>prior.at)latest.set(event.id,event);}return [...latest.values()].sort((a,b)=>a.at-b.at||(a.id<b.id?-1:a.id>b.id?1:0));}",
    visible: [
      [
        { id: "a", at: 5, payload: "new" },
        { id: "a", at: 2, payload: "old" },
      ],
      [],
    ],
    acceptance: [
      [
        { id: "a", at: 2, payload: 5 },
        { id: "a", at: 2, payload: 6 },
      ],
      [
        { id: "b", at: 2, payload: "" },
        { id: "a", at: 2, payload: null },
      ],
    ],
    audit: [
      [
        { id: "z", at: 5, payload: 0 },
        { id: "a", at: 2, payload: 1 },
        { id: "z", at: -1, payload: 2 },
      ],
      [
        { id: "c", at: 0, payload: false },
        { id: "c", at: 0, payload: [] },
      ],
      [
        { id: "__proto__", at: 0, payload: {} },
        { id: "constructor", at: 1, payload: null },
      ],
      [
        { id: "b", at: 5, payload: "x" },
        { id: "a", at: 5, payload: "y" },
        { id: "b", at: 5, payload: "z" },
      ],
    ],
    anchors: [
      [
        [
          { id: "a", at: 2, payload: "first" },
          { id: "a", at: 2, payload: "second" },
        ],
        [{ id: "a", at: 2, payload: "second" }],
      ],
    ],
  },
];

export const recoveryTasks = tasks.map((task): TaskDefinition =>
  task.id === "discount-units"
    ? {
        ...task,
        acceptance: [
          ...task.acceptance,
          { prices: [35, 35, 35, 500], bundleSize: 3, discountPercent: 33 },
        ],
        audit: [
          { prices: [17, 19, 23, 400, 500], bundleSize: 3, discountPercent: 17 },
          ...task.audit.slice(1),
        ],
        anchors: [
          ...task.anchors,
          [{ prices: [35, 35, 35, 500], bundleSize: 3, discountPercent: 33 }, 571],
        ],
      }
    : task,
);
