import { writeFileSync } from "node:fs";
import {
  ablate,
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
    detail:
      "recovery market from the last checkpoint, paid challenger, bond, the case's attempt cap",
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
      "the primary alone, retrying from its own checkpoint under the same cap, guarantee and budget; no market, no challenger",
  },
  {
    key: "no-challenger",
    title: "No chall",
    setup: ablate["no-challenger"],
    detail: "Backstop without the paid challenger",
  },
  {
    key: "no-market",
    title: "No market",
    setup: ablate["no-market"],
    detail:
      "Backstop without the recovery market: the failed primary retries from its own checkpoint",
  },
  {
    key: "no-bond",
    title: "No bond",
    setup: ablate["no-bond"],
    detail:
      "Backstop without the bond: no guarantor, no premium, no compensation, recovery paid from escrow only",
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
  const wrong = count("delivered-wrong");
  const customerNetCost = sum(
    results.map((result) => result.customerPaid - result.customerReceived),
  );
  return {
    "delivered-correct": correct,
    "delivered-wrong": wrong,
    compensated: count("compensated"),
    refunded: count("refunded"),
    wrongAcceptancePercent:
      correct + wrong === 0 ? null : Math.round((1000 * wrong) / (correct + wrong)) / 10,
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

const tallies = Object.fromEntries(modes.map((mode) => [mode.key, tally(mode.key)])) as Record<
  Mode,
  Tally
>;
const summary = {
  cases,
  modes: Object.fromEntries(modes.map((mode) => [mode.key, mode.detail])),
  ...tallies,
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
  "seed,fate,absent,challenger,max_attempts,failing_transfer,recovery,bond,mode,outcome,state,attempts,settled_after_ms,customer_paid_yocto,customer_received_yocto,bond_consumed_yocto,violations,replay_matches",
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
        setup.bond,
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
const seconds = (ms: number) => (ms / 1000).toFixed(1);

const lines: readonly { label: string; show: (entry: Tally) => string }[] = [
  ...(["delivered-correct", "delivered-wrong", "compensated", "refunded"] as const).map((key) => ({
    label: key,
    show: (entry: Tally) => String(entry[key]),
  })),
  {
    label: "wrong acceptance",
    show: (entry) =>
      entry.wrongAcceptancePercent === null ? "n/a" : `${entry.wrongAcceptancePercent.toFixed(1)}%`,
  },
  ...(["attempts", "ledgerChecks", "violations", "replayMismatches"] as const).map((key) => ({
    label: key,
    show: (entry: Tally) => String(entry[key]),
  })),
  { label: "bond paid out (NEAR)", show: (entry) => nearText(entry.bondConsumed) },
  { label: "customer net cost (NEAR)", show: (entry) => nearText(entry.customerNetCost) },
  { label: "cost per correct (NEAR)", show: (entry) => nearText(entry.customerCostPerCorrect) },
  { label: "mean settle (sim. s)", show: (entry) => seconds(entry.meanSettleMs) },
];

out(
  `Reliability arena: ${String(cases)} seeded fault-injection cases, each run in ${String(modes.length)} modes through the real`,
);
out(
  "orchestrator, verifier, challenger and ledger (FIXTURE agents and vault). Ground truth is the reference",
);
out(
  "oracle, not the pinned suite. This measures the mechanism over scripted agents, not AI quality.",
);
for (const mode of modes) out(`  ${mode.title.padEnd(11)}${mode.detail}`);
out("");
out(`${"".padEnd(26)}${modes.map((mode) => mode.title.padStart(10)).join("")}`);
for (const line of lines) {
  out(
    `${line.label.padEnd(26)}${modes.map((mode) => line.show(tallies[mode.key]).padStart(10)).join("")}`,
  );
}

const sameOutcome = (left: Mode, right: Mode) =>
  rows.filter((row) => row[left].outcome === row[right].outcome).length;
const moved = (from: Mode, to: Mode, before: string, after: string) =>
  rows.filter((row) => row[from].outcome === before && row[to].outcome === after).length;
const { backstop, retries, single } = tallies;

out("");
out(
  `Retries vs Single: the same outcome in ${String(sameOutcome("retries", "single"))} of ${String(cases)} cases, using ${String(retries.attempts - single.attempts)} more attempts.`,
);
if (sameOutcome("retries", "single") === cases) {
  out(
    "  Each scripted fault is bound to its agent: the killed primary dies again on every retry, and the",
  );
  out(
    "  wrong patch passes the pinned suite on its first attempt, so nothing fails and nothing is retried.",
  );
  out(
    "  The only transient fault in the matrix is the failing transfer, which every mode retries.",
  );
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
    `mean settle time (${seconds(retries.meanSettleMs)} vs ${seconds(backstop.meanSettleMs)} s)`,
    retries.meanSettleMs,
    backstop.meanSettleMs,
    true,
  ),
];
out(`Retries match or beat Backstop on: ${matched.length === 0 ? "nothing" : matched.join(", ")}.`);
const bondFor = (delivered: boolean) =>
  sum(
    rows
      .filter((row) => row.backstop.outcome.startsWith("delivered") === delivered)
      .map((row) => row.backstop.bondConsumed),
  );
out(
  `Against Retries, Backstop replaces ${String(moved("retries", "backstop", "delivered-wrong", "delivered-correct"))} wrong patches with correct ones, recovers ${String(moved("retries", "backstop", "compensated", "delivered-correct"))} dead primaries, and refuses`,
);
out(
  `${String(moved("retries", "backstop", "delivered-wrong", "compensated"))} wrong patches it cannot replace. Its bond pays ${nearText(bondFor(false))} NEAR compensating failures and`,
);
out(`${nearText(bondFor(true))} NEAR topping up recovery bids above the escrow.`);

out("");
out("Ablations, one part of Backstop switched off at a time, on the same cases:");
for (const mode of modes.filter((entry) => entry.key.startsWith("no-"))) {
  const entry = tallies[mode.key];
  const change = (key: "delivered-correct" | "delivered-wrong" | "compensated" | "refunded") =>
    `${key} ${String(backstop[key])} -> ${String(entry[key])}`;
  out(
    `  ${mode.title.padEnd(11)}changes ${String(cases - sameOutcome(mode.key, "backstop"))} of ${String(cases)} outcomes: ${change("delivered-correct")}, ${change("delivered-wrong")},`,
  );
  out(`  ${"".padEnd(11)}${change("compensated")}, ${change("refunded")}`);
}
const shippedWrong = (mode: Mode, fate: string) =>
  rows.filter((row) => row[mode].outcome === "delivered-wrong" && row.setup.fate === fate).length;
const unchallenged = tallies["no-challenger"]["delivered-wrong"];
out(
  `  Without the challenger ${String(unchallenged)} wrong patches ship, ${unchallenged > single["delivered-wrong"] ? "more than" : "no more than"} the single agent's ${String(single["delivered-wrong"])}:`,
);
out(
  `  ${String(shippedWrong("no-challenger", "delivers-wrong"))} wrong primaries and ${String(shippedWrong("no-challenger", "dies"))} recoveries won by a bid whose patch passes the suite but is wrong.`,
);
const dead = rows.filter((row) => row.setup.fate === "dies");
const recovered = (mode: Mode) =>
  dead.filter((row) => row[mode].outcome === "delivered-correct").length;
out(
  `  No market vs Retries: the same outcome in ${String(sameOutcome("no-market", "retries"))} of ${String(cases)} cases. Keeping the challenger turns ${String(moved("retries", "no-market", "delivered-wrong", "compensated"))} wrong`,
);
out(
  `  deliveries into compensated failures; ${String(recovered("no-market"))} of ${String(dead.length)} dead primaries are recovered (Backstop: ${String(recovered("backstop"))}).`,
);
const recoveries = rows.filter(
  (row) => row.backstop.outcome === "delivered-correct" && row.backstop.attempts > 1,
);
const toppedUp = recoveries.filter((row) => row.backstop.bondConsumed > 0n).length;
out(
  `  Without the bond nothing is compensated (${String(tallies["no-bond"].refunded)} refunds) and ${String(moved("no-bond", "backstop", "refunded", "delivered-correct"))} of Backstop's correct deliveries are lost;`,
);
out(
  `  ${String(toppedUp)} of Backstop's ${String(recoveries.length)} correct recoveries needed bond on top of the escrow. With no guarantee, no premium is paid.`,
);
out("Raw data: benchmarks/arena.json, benchmarks/arena.csv");
