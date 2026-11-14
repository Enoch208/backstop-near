import { z } from "zod";
import raw from "../../../../benchmarks/arena.json" with { type: "json" };

const count = z.number().int().nonnegative();
const yocto = z.string().regex(/^\d+$/);

const modeSchema = z.object({
  "delivered-correct": count,
  "delivered-wrong": count,
  compensated: count,
  refunded: count,
  wrongAcceptancePercent: z.number().nonnegative(),
  attempts: count,
  ledgerChecks: count,
  violations: count,
  replayMismatches: count,
  bondConsumed: yocto,
  customerNetCost: yocto,
  customerCostPerCorrect: yocto,
  meanSettleMs: z.number().nonnegative(),
});

const labels = {
  backstop: "Backstop",
  single: "Single agent",
  retries: "Single agent with retries",
  "no-challenger": "No challenger",
  "no-market": "No recovery market",
  "no-bond": "No bond",
} as const;

export type ModeKey = keyof typeof labels;

const modeKeys: readonly ModeKey[] = [
  "backstop",
  "single",
  "retries",
  "no-challenger",
  "no-market",
  "no-bond",
];

const summary = z
  .object({
    cases: count,
    modes: z.record(z.enum(modeKeys), z.string()),
    backstop: modeSchema,
    single: modeSchema,
    retries: modeSchema,
    "no-challenger": modeSchema,
    "no-market": modeSchema,
    "no-bond": modeSchema,
  })
  .parse(raw.summary);

export type ArenaMode = z.infer<typeof modeSchema> & {
  readonly key: ModeKey;
  readonly label: string;
  readonly description: string;
};

export const cases = summary.cases;

export const outcomeKeys = [
  "delivered-correct",
  "compensated",
  "refunded",
  "delivered-wrong",
] as const;

export type OutcomeKey = (typeof outcomeKeys)[number];

export const outcomeLabels: Record<OutcomeKey, string> = {
  "delivered-correct": "Correct",
  compensated: "Compensated",
  refunded: "Refunded",
  "delivered-wrong": "Wrong",
};

export const arenaModes: readonly ArenaMode[] = modeKeys.map((key) => {
  const mode = summary[key];
  const outcomes = outcomeKeys.reduce((sum, outcome) => sum + mode[outcome], 0);
  if (outcomes !== cases) {
    throw new Error(`Arena mode ${key} accounts for ${String(outcomes)} of ${String(cases)} cases`);
  }
  const text = summary.modes[key];
  const description = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return { ...mode, key, label: labels[key], description };
});

const words = "zero one two three four five six seven eight nine".split(" ");

export const modeCountWord = words[arenaModes.length] ?? String(arenaModes.length);

export const arenaMode = (key: ModeKey): ArenaMode => {
  const mode = arenaModes.find((entry) => entry.key === key);
  if (mode === undefined) throw new Error(`The arena summary has no mode ${key}`);
  return mode;
};

const sum = (pick: (mode: ArenaMode) => number) =>
  arenaModes.reduce((total, mode) => total + pick(mode), 0);

export const totals = {
  violations: sum((mode) => mode.violations),
  ledgerChecks: sum((mode) => mode.ledgerChecks),
};

export function near(amount: string, decimals: number): string {
  const unit = 10n ** BigInt(24 - decimals);
  const rounded = (BigInt(amount) + unit / 2n) / unit;
  const scale = 10n ** BigInt(decimals);
  const fraction = (rounded % scale).toString().padStart(decimals, "0");
  return `${(rounded / scale).toString()}.${fraction}`;
}

export const percent = (value: number) => `${value.toLocaleString("en-US")}%`;

export const countsLine = (mode: ArenaMode) =>
  outcomeKeys.map((key) => `${String(mode[key])} ${outcomeLabels[key].toLowerCase()}`).join(" · ");

const labelShare = 0.06;

export function segmentLabels(mode: ArenaMode) {
  const visible = outcomeKeys.filter((key) => mode[key] > 0);
  const placed: { readonly key: OutcomeKey; readonly at: number; readonly end: boolean }[] = [];
  let start = 0;
  let reach = 0;
  visible.forEach((key, index) => {
    if (mode[key] / cases >= labelShare) {
      placed.push({ key, at: start / cases, end: false });
      reach = start / cases + labelShare;
    } else if (index === visible.length - 1 && reach <= 1 - labelShare) {
      placed.push({ key, at: 1, end: true });
    }
    start += mode[key];
  });
  return placed;
}

export const columns: readonly {
  readonly label: string;
  readonly sub?: string;
  readonly value: (mode: ArenaMode) => string;
}[] = [
  { label: "Correct", value: (mode) => String(mode["delivered-correct"]) },
  { label: "Wrong", value: (mode) => String(mode["delivered-wrong"]) },
  { label: "Compensated", value: (mode) => String(mode.compensated) },
  { label: "Refunded", value: (mode) => String(mode.refunded) },
  { label: "Wrong", sub: "acceptance", value: (mode) => percent(mode.wrongAcceptancePercent) },
  { label: "Bond paid out", sub: "(NEAR)", value: (mode) => near(mode.bondConsumed, 2) },
  {
    label: "Cost per correct",
    sub: "(NEAR)",
    value: (mode) => near(mode.customerCostPerCorrect, 3),
  },
  {
    label: "Violations /",
    sub: "replay mismatches",
    value: (mode) => `${String(mode.violations)} / ${String(mode.replayMismatches)}`,
  },
];

const move = (from: number, to: number) => `${String(from)} → ${String(to)}`;

export function contributions() {
  const full = arenaMode("backstop");
  const single = arenaMode("single");
  const retries = arenaMode("retries");
  const bare = arenaMode("no-challenger");
  const market = arenaMode("no-market");
  const bond = arenaMode("no-bond");
  const same = outcomeKeys.every((key) => single[key] === retries[key]);
  const wrong = [full["delivered-wrong"], bare["delivered-wrong"]] as const;
  const correct = [full["delivered-correct"], market["delivered-correct"]] as const;
  return [
    {
      title: "The paid challenger",
      figure: move(...wrong),
      measure: "wrong patches delivered",
      text: `Without the challenger, wrong patches delivered go from ${String(wrong[0])} to ${String(wrong[1])} and wrong acceptance goes from ${percent(full.wrongAcceptancePercent)} to ${percent(bare.wrongAcceptancePercent)}.`,
    },
    {
      title: "The recovery market",
      figure: move(...correct),
      measure: "correct patches delivered",
      text: `Without the market, the failed primary retries from its own checkpoint: correct deliveries go from ${String(correct[0])} to ${String(correct[1])} and attempts from ${String(full.attempts)} to ${String(market.attempts)}.`,
    },
    {
      title: "The bond",
      figure: move(full.compensated, bond.compensated),
      measure: "cases compensated",
      text: `Without the bond, compensated cases go from ${String(full.compensated)} to ${String(bond.compensated)}. The ${String(bond.refunded)} cases that do not deliver are refunded with no compensation.`,
    },
    {
      title: "Retries alone",
      figure: move(single.attempts, retries.attempts),
      measure: "attempts",
      text: same
        ? `Retrying from its own checkpoint takes ${String(retries.attempts)} attempts instead of ${String(single.attempts)} and gives the same outcome counts as the single agent here (${countsLine(retries)}), because each scripted fault is tied to its agent.`
        : `Retrying from its own checkpoint gives ${countsLine(retries)}, against ${countsLine(single)} for the single agent.`,
    },
  ];
}

export const rawArenaUrl =
  "https://github.com/Enoch208/backstop-near/blob/main/benchmarks/arena.json";
