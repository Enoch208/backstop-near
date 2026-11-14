import {
  arenaMode,
  arenaModes,
  cases,
  columns,
  contributions,
  countsLine,
  modeCountWord,
  outcomeKeys,
  outcomeLabels,
  percent,
  rawArenaUrl,
  segmentLabels,
  totals,
  type ArenaMode,
  type OutcomeKey,
} from "../data/arena.js";
import { Icon } from "./icons.js";
import { Chip, Kpi, PageHeader, Panel, buttonClass } from "./ui.js";

const fills: Record<OutcomeKey, string> = {
  "delivered-correct": "bg-ink",
  compensated: "bg-ink/45",
  refunded: "bg-ink/25",
  "delivered-wrong": "bg-fail",
};

function OutcomeBar({ mode }: { readonly mode: ArenaMode }) {
  return (
    <div className="min-w-0">
      <div
        aria-hidden="true"
        className="relative h-4 text-[12px] leading-4 text-ink/60 tabular-nums"
      >
        {segmentLabels(mode).map((label) => (
          <span
            key={label.key}
            className="absolute top-0"
            style={label.end ? { right: 0 } : { left: `${String(label.at * 100)}%` }}
          >
            {mode[label.key]}
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={`${mode.label}: ${countsLine(mode)}, of ${String(cases)} cases`}
        className="mt-1 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {outcomeKeys
          .filter((key) => mode[key] > 0)
          .map((key) => (
            <span
              key={key}
              title={`${outcomeLabels[key]}: ${String(mode[key])} of ${String(cases)}`}
              className={`basis-0 ${fills[key]}`}
              style={{ flexGrow: mode[key] }}
            />
          ))}
      </div>
      <p className="mt-2 text-[12px] leading-[1.4] text-ink/60 tabular-nums">{countsLine(mode)}</p>
    </div>
  );
}

function Outcomes() {
  return (
    <Panel title="Outcomes by mode" meta={`${String(cases)} cases per mode`}>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 pb-6" aria-label="Legend">
        {outcomeKeys.map((key) => (
          <li key={key} className="flex items-center gap-2 text-[12px] text-ink/60">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${fills[key]}`} />
            {outcomeLabels[key]}
          </li>
        ))}
      </ul>
      <ol className="flex flex-col gap-6">
        {arenaModes.map((mode) => (
          <li
            key={mode.key}
            className="grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-center lg:gap-8"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] leading-[1.5] font-medium tracking-[-0.02em]">
                  {mode.label}
                </p>
                {mode.key === "backstop" && <Chip tone="info">Full protocol</Chip>}
              </div>
              <p className="mt-1 text-[13px] leading-[1.5] tracking-[-0.02em] text-pretty text-ink/60">
                {mode.description}
              </p>
            </div>
            <OutcomeBar mode={mode} />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Numbers() {
  const well = (mode: ArenaMode) => (mode.key === "backstop" ? "bg-well" : "");
  const edge = (index: number) => (index === columns.length - 1 ? "pr-3 pl-2" : "px-2");
  return (
    <Panel title="The numbers" meta="Amounts in NEAR" flush>
      <div className="overflow-x-auto px-6 pb-6">
        <table className="w-full border-separate border-spacing-0 text-[13px] tracking-[-0.02em] tabular-nums">
          <thead>
            <tr className="text-[12px] text-ink/60">
              <th scope="col" className="px-3 pb-3 text-left align-bottom font-normal">
                Mode
              </th>
              {columns.map((column, index) => (
                <th
                  key={`${column.label} ${column.sub ?? ""}`}
                  scope="col"
                  className={`pb-3 text-right align-bottom leading-[1.3] font-normal whitespace-nowrap ${edge(index)}`}
                >
                  {column.label}
                  {column.sub !== undefined && <span className="block">{column.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arenaModes.map((mode) => (
              <tr key={mode.key}>
                <th
                  scope="row"
                  className={`rounded-l-xl px-3 py-3 text-left font-medium whitespace-nowrap ${well(mode)}`}
                >
                  {mode.label}
                </th>
                {columns.map((column, index) => (
                  <td
                    key={`${column.label} ${column.sub ?? ""}`}
                    className={`py-3 text-right ${edge(index)} ${index === columns.length - 1 ? "rounded-r-xl" : ""} ${well(mode)}`}
                  >
                    {column.value(mode)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Contributions() {
  return (
    <Panel title="What each part contributes" meta="Minus one part">
      <ul className="grid gap-4 sm:grid-cols-2">
        {contributions().map((item) => (
          <li key={item.title} className="flex flex-col gap-3 rounded-2xl bg-well p-5">
            <p className="text-[14px] leading-[1.5] font-medium tracking-[-0.02em]">{item.title}</p>
            <p className="text-[24px] leading-[1.1] font-medium tracking-[-0.04em]">
              {item.figure}
              <span className="ml-2 text-[13px] tracking-[-0.02em] text-ink/60">
                {item.measure}
              </span>
            </p>
            <p className="text-[14px] leading-[1.5] tracking-[-0.02em] text-pretty text-ink/60">
              {item.text}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ArenaPage() {
  const full = arenaMode("backstop");
  const single = arenaMode("single");
  return (
    <>
      <PageHeader
        eyebrow="Reliability arena"
        title={`${String(cases)} fault cases, ${modeCountWord} ways to run them.`}
        subtitle="Each seeded case runs through the real orchestrator, verifier, challenger and ledger in every mode. The agents are scripted, so this measures the mechanism, not AI quality."
        actions={
          <a
            href={rawArenaUrl}
            target="_blank"
            rel="noreferrer"
            className={`${buttonClass.secondary} shrink-0 whitespace-nowrap`}
          >
            Raw data on GitHub
            <Icon name="external" size={14} />
          </a>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi
            primary
            label="Correct patches delivered"
            value={full["delivered-correct"]}
            unit={`vs ${String(single["delivered-correct"])}`}
            note={`Backstop vs single agent, ${String(cases)} cases`}
          />
          <Kpi
            label="Wrong patches shipped"
            value={full["delivered-wrong"]}
            unit={`vs ${String(single["delivered-wrong"])}`}
            note="Backstop vs single agent"
          />
          <Kpi
            label="Wrong acceptance"
            value={percent(full.wrongAcceptancePercent)}
            unit={`vs ${percent(single.wrongAcceptancePercent)}`}
            note="Wrong share of delivered patches"
          />
          <Kpi
            label="Ledger violations"
            value={totals.violations}
            unit={`in ${String(totals.ledgerChecks)} checks`}
            note="Across every mode and case"
          />
        </div>
        <Outcomes />
        <Numbers />
        <Contributions />
      </div>
    </>
  );
}
