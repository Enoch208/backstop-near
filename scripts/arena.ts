import { writeFileSync } from "node:fs";
import {
  arenaCase,
  baseline,
  retryBaseline,
  runArenaCase,
  type ArenaCase,
  type ArenaResult,
} from "@backstop/orchestrator";
import { formatNear } from "@backstop/shared";

const cases = Number(process.argv[2] ?? "32");
const out = (line: string) => process.stdout.write(`${line}\n`);

const modes = [
  {
    key: "backstop",
    title: "Backstop",
    setup: (setup: ArenaCase) => setup,
    detail: "recovery market from the last checkpoint, paid challenger, the case's attempt cap",
  },
  {
    key: "single",
    title: "Single",
    setup: baseline,
    detail: "the primary alone: one attempt, no recovery market, no challenger",
  },
  {
    key: "retries",
    title: "Retries",
    setup: retryBaseline,
    detail:
      "the primary alone, retrying from its own checkpoint under the same attempt cap, guarantee and budget",
  },
] as const;
type Mode = (typeof modes)[number]["key"];

const rows = Array.from({ length: cases }, (_, index) => {
  const setup = arenaCase(index + 1);
  const results = Object.fromEntries(
    modes.map((mode) => [mode.key, runArenaCase(mode.setup(setup), mode.key)]),
  ) as Record<Mode, ArenaResult>;
  return { setup, ...results };
});

const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);

const tally = (mode: Mode) => {
  const results = rows.map((row) => row[mode]);
  const count = (outcome: string) => results.filter((result) => result.outcome === outcome).length;
  const correct = count("delivered-correct");
  const customerNetCost = sum(
    results.map((result) => result.customerPaid - result.customerReceived),
  );
  return {
    "delivered-correct": correct,
    "delivered-wrong": count("delivered-wrong"),
    compensated: count("compensated"),
    refunded: count("refunded"),
    attempts: results.reduce((total, result) => total + result.attempts, 0),
    ledgerChecks: results.reduce((total, result) => total + result.ledgerChecks, 0),
    violations: results.reduce((total, result) => total + result.violations.length, 0),
    replayMismatches: results.filter((result) => !result.replayMatches).length,
    bondConsumed: sum(results.map((result) => result.bondConsumed)),
    customerNetCost,
    customerCostPerCorrect: correct === 0 ? null : customerNetCost / BigInt(correct),
    meanSettleMs: Math.round(
      results.reduce((total, result) => total + result.settledAfterMs, 0) / results.length,
    ),
  };
};
type Tally = ReturnType<typeof tally>;

const summary = {
  cases,
  modes: Object.fromEntries(modes.map((mode) => [mode.key, mode.detail])),
  backstop: tally("backstop"),
  single: tally("single"),
  retries: tally("retries"),
};
const plain = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
writeFileSync(
  new URL("../benchmarks/arena.json", import.meta.url),
  `${plain({ summary, rows })}\n`,
);
const csv = [
  "seed,fate,absent,challenger,max_attempts,failing_transfer,recovery,mode,outcome,state,attempts,settled_after_ms,customer_paid_yocto,customer_received_yocto,bond_consumed_yocto,violations,replay_matches",
  ...rows.flatMap((row) =>
    modes.map((mode) => {
      const setup = mode.setup(row.setup);
      const result = row[mode.key];
      return [
        setup.seed,
        setup.fate,
        setup.absent.join("+"),
        setup.challenger,
        setup.maxAttempts,
        setup.failingTransfer,
        setup.recovery,
        mode.key,
        result.outcome,
        result.state,
        result.attempts,
        result.settledAfterMs,
        result.customerPaid.toString(),
        result.customerReceived.toString(),
        result.bondConsumed.toString(),
        result.violations.length,
        result.replayMatches,
      ].join(",");
    }),
  ),
].join("\n");
writeFileSync(new URL("../benchmarks/arena.csv", import.meta.url), `${csv}\n`);

const nearText = (amount: bigint | null) => {
  if (amount === null) return "n/a";
  const step = 10n ** 20n;
  const magnitude = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${formatNear(((magnitude + step / 2n) / step) * step)}`;
};

const lines: readonly { label: string; show: (entry: Tally) => string }[] = [
  ...(
    [
      "delivered-correct",
      "delivered-wrong",
      "compensated",
      "refunded",
      "attempts",
      "ledgerChecks",
      "violations",
      "replayMismatches",
    ] as const
  ).map((key) => ({ label: key, show: (entry: Tally) => String(entry[key]) })),
  { label: "bond paid out (NEAR)", show: (entry) => nearText(entry.bondConsumed) },
  { label: "customer net cost (NEAR)", show: (entry) => nearText(entry.customerNetCost) },
  { label: "cost per correct (NEAR)", show: (entry) => nearText(entry.customerCostPerCorrect) },
  { label: "mean settle (sim. s)", show: (entry) => (entry.meanSettleMs / 1000).toFixed(1) },
];

out(
  `Reliability arena: ${String(cases)} seeded fault-injection cases, each run three ways through the real`,
);
out(
  "orchestrator, verifier, challenger and ledger (FIXTURE agents and vault). Ground truth is the reference",
);
out(
  "oracle, not the pinned suite. This measures the mechanism over scripted agents, not AI quality.",
);
for (const mode of modes) out(`  ${mode.title.padEnd(10)}${mode.detail}`);
out(`  ${"".padEnd(10)}(no recovery market, no challenger)`);
out("");
out(`${"".padEnd(26)}${modes.map((mode) => mode.title.padStart(10)).join("")}`);
for (const line of lines) {
  out(
    `${line.label.padEnd(26)}${modes.map((mode) => line.show(summary[mode.key]).padStart(10)).join("")}`,
  );
}

const { backstop, retries, single } = summary;
const unchanged = rows.filter((row) => row.retries.outcome === row.single.outcome).length;
out("");
out(
  `Retries vs Single: the same outcome in ${String(unchanged)} of ${String(cases)} cases, using ${String(retries.attempts - single.attempts)} more attempts.`,
);
if (unchanged === cases) {
  out(
    "Each scripted fault is bound to its agent: the killed primary dies again on every retry, and the wrong",
  );
  out(
    "patch passes the pinned suite on its first attempt, so nothing fails and nothing is retried. The only",
  );
  out("transient fault in the matrix is the failing transfer, which every mode retries.");
}
const atLeast = (label: string, ours: bigint | number, theirs: bigint | number, lower: boolean) =>
  (lower ? ours <= theirs : ours >= theirs) ? [label] : [];
const matched = [
  ...atLeast(
    "delivered-correct",
    retries["delivered-correct"],
    backstop["delivered-correct"],
    false,
  ),
  ...atLeast("delivered-wrong", retries["delivered-wrong"], backstop["delivered-wrong"], true),
  ...atLeast("violations", retries.violations, backstop.violations, true),
  ...atLeast("replay mismatches", retries.replayMismatches, backstop.replayMismatches, true),
  ...atLeast(
    `bond paid out (${nearText(retries.bondConsumed)} vs ${nearText(backstop.bondConsumed)} NEAR)`,
    retries.bondConsumed,
    backstop.bondConsumed,
    true,
  ),
  ...atLeast(
    `customer cost per correct delivery (${nearText(retries.customerCostPerCorrect)} vs ${nearText(backstop.customerCostPerCorrect)} NEAR)`,
    retries.customerCostPerCorrect ?? 0n,
    backstop.customerCostPerCorrect ?? 0n,
    true,
  ),
  ...atLeast(
    `mean settle time (${(retries.meanSettleMs / 1000).toFixed(1)} vs ${(backstop.meanSettleMs / 1000).toFixed(1)} s)`,
    retries.meanSettleMs,
    backstop.meanSettleMs,
    true,
  ),
];
out(`Retries match or beat Backstop on: ${matched.length === 0 ? "nothing" : matched.join(", ")}.`);
const refused = rows.filter(
  (row) => row.retries.outcome === "delivered-wrong" && row.backstop.outcome === "compensated",
).length;
const rescued = rows.filter(
  (row) => row.retries.outcome === "compensated" && row.backstop.outcome === "delivered-correct",
).length;
const repaired = rows.filter(
  (row) =>
    row.retries.outcome === "delivered-wrong" && row.backstop.outcome === "delivered-correct",
).length;
const bondFor = (delivered: boolean) =>
  sum(
    rows
      .filter((row) => row.backstop.outcome.startsWith("delivered") === delivered)
      .map((row) => row.backstop.bondConsumed),
  );
out(
  `Against Retries, Backstop replaces ${String(repaired)} wrong patches with correct ones, recovers ${String(rescued)} dead primaries, and refuses`,
);
out(
  `${String(refused)} wrong patches it cannot replace. Its bond pays ${nearText(bondFor(false))} NEAR compensating failures and`,
);
out(`${nearText(bondFor(true))} NEAR topping up recovery bids above the escrow.`);
out("Raw data: benchmarks/arena.json, benchmarks/arena.csv");
