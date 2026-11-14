import { formatNear, near, seededRandom, sumYocto } from "@backstop/shared";
import { faults, type Trial } from "./run.js";
import { modes, type Mode } from "./schedule.js";

function percentile(values: readonly number[], percentile: number): number | null {
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * percentile) - 1)] ?? null;
}

const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

function parseNear(amount: string): bigint {
  return amount.startsWith("-") ? -near(amount.slice(1)) : near(amount);
}

function summarize(rows: readonly Trial[]) {
  const correct = rows.filter((row) => row.correct).length;
  const wrong = rows.filter((row) => row.accepted && !row.correct).length;
  const calls = rows.flatMap((row) =>
    row.attempts.flatMap((attempt) => (attempt.inference === null ? [] : [attempt.inference])),
  );
  const knownTokens = calls.flatMap(({ promptTokens, outputTokens }) =>
    promptTokens === null || outputTokens === null ? [] : [promptTokens + outputTokens],
  );
  const seconds = rows.map(({ elapsedMs }) => elapsedMs / 1_000);
  const knownTokenTotal = total(knownTokens);
  const cost = sumYocto(
    rows.map((row) => parseNear(row.customerNetNear) + near(row.compensationNear)),
  );
  return {
    trials: rows.length,
    correct,
    wrong,
    notAccepted: rows.length - correct - wrong,
    correctRate: rows.length === 0 ? null : correct / rows.length,
    wrongAcceptanceRate: correct + wrong === 0 ? null : wrong / (correct + wrong),
    medianSeconds: percentile(seconds, 0.5),
    p95Seconds: percentile(seconds, 0.95),
    providerCallAttempts: calls.length,
    providerCallsWithReportedTokens: knownTokens.length,
    knownTokenTotal,
    tokensPerCorrect:
      correct > 0 && knownTokens.length === calls.length ? knownTokenTotal / correct : null,
    customerNearBeforeCompensationPerCorrect:
      correct === 0 ? null : formatNear(cost / BigInt(correct)),
    totalCompensationNear: formatNear(sumYocto(rows.map((row) => near(row.compensationNear)))),
    totalBondConsumedNear: formatNear(sumYocto(rows.map((row) => near(row.bondConsumedNear)))),
  };
}

function paired(rows: readonly Trial[], baseline: Exclude<Mode, "market">, seed: number) {
  const key = (row: Trial) => JSON.stringify([row.task, row.fault, row.repeat]);
  const lookup = new Map(rows.filter((row) => row.mode === baseline).map((row) => [key(row), row]));
  const groups = new Map<string, number[]>();
  let wins = 0;
  let losses = 0;
  for (const row of rows.filter(({ mode }) => mode === "market")) {
    const other = lookup.get(key(row));
    if (other === undefined) continue;
    const diff = Number(row.correct) - Number(other.correct);
    if (diff > 0) wins++;
    if (diff < 0) losses++;
    const group = groups.get(row.task) ?? [];
    group.push(diff);
    groups.set(row.task, group);
  }
  const clusters = [...groups.values()];
  const pairs = total(clusters.map((cluster) => cluster.length));
  const random = seededRandom(seed);
  const boot =
    clusters.length < 2
      ? []
      : Array.from({ length: 4_000 }, () => {
          const sampled = clusters.flatMap(
            () => clusters[Math.floor(random() * clusters.length)] ?? [],
          );
          return total(sampled) / sampled.length;
        });
  return {
    baseline,
    distinctTaskClusters: clusters.length,
    pairs,
    marketWins: wins,
    marketLosses: losses,
    correctRateDifference: pairs === 0 ? null : (wins - losses) / pairs,
    exploratory95PercentTaskClusterBootstrap:
      boot.length === 0 ? null : [percentile(boot, 0.025), percentile(boot, 0.975)],
  };
}

export function results(rows: readonly Trial[], seed: number) {
  return {
    byMode: Object.fromEntries(
      modes.map((mode) => [mode, summarize(rows.filter((row) => row.mode === mode))]),
    ),
    byFaultAndMode: Object.fromEntries(
      faults.map((fault) => [
        fault,
        Object.fromEntries(
          modes.map((mode) => [
            mode,
            summarize(rows.filter((row) => row.mode === mode && row.fault === fault)),
          ]),
        ),
      ]),
    ),
    paired: [paired(rows, "single", seed), paired(rows, "fixed", seed)],
  };
}
