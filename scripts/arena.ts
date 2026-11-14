import { writeFileSync } from "node:fs";
import { arenaCase, baseline, runArenaCase, type ArenaResult } from "@backstop/orchestrator";
import { formatNear } from "@backstop/shared";

const cases = Number(process.argv[2] ?? "32");
const out = (line: string) => process.stdout.write(`${line}\n`);

const rows = Array.from({ length: cases }, (_, index) => {
  const setup = arenaCase(index + 1);
  return {
    setup,
    backstop: runArenaCase(setup, "backstop"),
    single: runArenaCase(baseline(setup), "single"),
  };
});

const tally = (pick: (row: (typeof rows)[number]) => ArenaResult) => {
  const results = rows.map(pick);
  const count = (outcome: string) => results.filter((result) => result.outcome === outcome).length;
  return {
    "delivered-correct": count("delivered-correct"),
    "delivered-wrong": count("delivered-wrong"),
    compensated: count("compensated"),
    refunded: count("refunded"),
    ledgerChecks: results.reduce((total, result) => total + result.ledgerChecks, 0),
    violations: results.reduce((total, result) => total + result.violations.length, 0),
    replayMismatches: results.filter((result) => !result.replayMatches).length,
  };
};

const summary = {
  cases,
  backstop: tally((row) => row.backstop),
  single: tally((row) => row.single),
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
  "seed,fate,absent,challenger,max_attempts,failing_transfer,mode,outcome,state,attempts,settled_after_ms,customer_paid_yocto,customer_received_yocto,bond_consumed_yocto,violations,replay_matches",
  ...rows.flatMap(({ setup, backstop, single }) =>
    (
      [
        ["backstop", backstop],
        ["single", single],
      ] as const
    ).map(([mode, result]) =>
      [
        setup.seed,
        setup.fate,
        setup.absent.join("+"),
        setup.challenger,
        setup.maxAttempts,
        setup.failingTransfer,
        mode,
        result.outcome,
        result.state,
        result.attempts,
        result.settledAfterMs,
        result.customerPaid.toString(),
        result.customerReceived.toString(),
        result.bondConsumed.toString(),
        result.violations.length,
        result.replayMatches,
      ].join(","),
    ),
  ),
].join("\n");
writeFileSync(new URL("../benchmarks/arena.csv", import.meta.url), `${csv}\n`);

out(
  `Reliability arena: ${String(cases)} seeded fault-injection cases, each run twice through the real orchestrator,`,
);
out(
  "verifier, challenger and ledger (FIXTURE agents and vault): Backstop vs a single agent with no recovery market",
);
out("and no challenger. Ground truth is the reference oracle, not the pinned suite.");
out("");
out(`${"".padEnd(22)}${"Backstop".padStart(10)}${"Single".padStart(10)}`);
for (const key of Object.keys(summary.backstop) as (keyof typeof summary.backstop)[]) {
  out(
    `${key.padEnd(22)}${String(summary.backstop[key]).padStart(10)}${String(summary.single[key]).padStart(10)}`,
  );
}
const bond = rows.reduce((total, row) => total + row.backstop.bondConsumed, 0n);
out("");
out(
  `Bond consumed across all Backstop cases: ${formatNear(bond)} NEAR. Raw data: benchmarks/arena.json, benchmarks/arena.csv`,
);
