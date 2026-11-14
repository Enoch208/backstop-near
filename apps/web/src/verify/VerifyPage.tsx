import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../app/icons.js";
import { buttonClass, Chip, Kpi, PageHeader, Panel } from "../app/ui.js";
import { record } from "../data/record.js";
import { runChecks, type Check, type Tamper } from "./checks.js";

const tampers: readonly { readonly value: Tamper; readonly label: string }[] = [
  { value: "none", label: "Check the record as published" },
  { value: "settled-twice", label: "Tamper: claim the second settlement succeeded" },
  { value: "paid-more", label: "Tamper: claim the vault paid out 0.70 NEAR" },
  { value: "other-key", label: "Tamper: claim a different enclave key" },
  { value: "forged-receipt", label: "Tamper: alter one byte of the AI receipt" },
];

const groups: readonly Check["group"][] = [
  "Code",
  "Enclave key",
  "AI receipt",
  "Attacks refused on chain",
  "Ledgers",
  "Transactions",
];

const machineDetail: ReadonlySet<Check["group"]> = new Set(["Code", "AI receipt", "Ledgers"]);

const expected =
  1 + 1 + 1 + record.runs.length + record.runs.reduce((total, run) => total + run.steps.length, 0);

function CheckRow({ check }: { readonly check: Check }) {
  const mono = machineDetail.has(check.group);
  return (
    <li className="rise grid min-h-11 grid-cols-[72px_minmax(0,1fr)] items-start gap-3 py-3">
      {check.ok ? (
        <Chip tone="pass">Pass</Chip>
      ) : check.unread === true ? (
        <Chip tone="neutral">Unread</Chip>
      ) : (
        <Chip tone="fail">Fail</Chip>
      )}
      <div className="min-w-0 pt-0.5">
        <p className="text-[14px] leading-[1.5] tracking-[-0.02em] text-ink">
          {check.link === null ? (
            check.label
          ) : (
            <a
              href={check.link}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:underline"
            >
              {check.label}
              <span className="ml-1 inline-block align-[-2px] text-ink/40">
                <Icon name="external" size={14} />
              </span>
            </a>
          )}
        </p>
        <p
          className={`mt-0.5 text-[13px] leading-[1.5] wrap-anywhere text-ink/60 ${mono ? "font-mono tracking-normal" : "tracking-[-0.02em]"}`}
        >
          {check.detail}
        </p>
      </div>
    </li>
  );
}

export function VerifyPage() {
  const [tamper, setTamper] = useState<Tamper>("none");
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const run = useCallback((mode: Tamper) => {
    generation.current += 1;
    const mine = generation.current;
    setChecks([]);
    setError(null);
    setRunning(true);
    runChecks(mode, (check) => {
      if (generation.current === mine) setChecks((previous) => [...previous, check]);
    })
      .catch((reason: unknown) => {
        if (generation.current === mine)
          setError(reason instanceof Error ? reason.message : "NEAR RPC unreachable");
      })
      .finally(() => {
        if (generation.current === mine) setRunning(false);
      });
  }, []);

  useEffect(() => {
    run(tamper);
  }, [run, tamper]);

  const passed = checks.filter((check) => check.ok).length;
  const unread = checks.filter((check) => check.unread === true).length;
  const failed = checks.length - passed - unread;
  const status = running
    ? "checking…"
    : error !== null
      ? `stopped: ${error}`
      : failed > 0
        ? `${String(failed)} claim${failed === 1 ? "" : "s"} failed`
        : unread > 0
          ? `${String(unread)} could not be read from the RPC; run again`
          : "every claim holds";
  return (
    <>
      <PageHeader
        eyebrow="Verify"
        title="Every claim, re-checked against NEAR."
        subtitle="No backend and no wallet: the page calls a public NEAR RPC directly and re-reads every claim in the public record. Tamper with the record to watch a check catch the lie."
        actions={
          <>
            <label className="relative inline-flex max-w-full">
              <span className="sr-only">Record to check</span>
              <select
                value={tamper}
                onChange={(event) => {
                  const next = tampers.find((item) => item.value === event.target.value);
                  if (next !== undefined) setTamper(next.value);
                }}
                className={`${buttonClass.secondary} max-w-full cursor-pointer appearance-none truncate border-0 pr-10`}
              >
                {tampers.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rotate-90 text-ink/60">
                <Icon name="forward" size={14} />
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                run(tamper);
              }}
              className={buttonClass.primary}
            >
              Run again
            </button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          primary
          label="Claims holding"
          value={passed}
          unit={`/ ${String(expected)}`}
          note={<span title={status}>{status}</span>}
        />
        <Kpi label="Failed" value={failed} note="claims the chain contradicts" />
        <Kpi label="Could not read" value={unread} note="RPC rate limits; run again" />
        <Kpi label="Source" value="RPC" note="public NEAR testnet RPC" />
      </div>
      <div
        role="progressbar"
        aria-label="Checks read"
        aria-valuemin={0}
        aria-valuemax={expected}
        aria-valuenow={checks.length}
        className="mt-4 h-1 overflow-hidden rounded-full bg-ink/[0.06]"
      >
        <div
          className={`h-1 rounded-full transition-all ${failed > 0 ? "bg-fail" : "bg-pass"}`}
          style={{ width: `${String(Math.min(100, (checks.length / expected) * 100))}%` }}
        />
      </div>
      <div className="mt-4 flex flex-col gap-4 lg:mt-6 lg:gap-6">
        {error !== null && (
          <Panel title="Run stopped" meta="error">
            <p className="font-mono text-[13px] leading-[1.5] wrap-anywhere text-ink/60">{error}</p>
          </Panel>
        )}
        {groups.map((group) => {
          const rows = checks.filter((check) => check.group === group);
          if (rows.length === 0) return null;
          const holding = rows.filter((check) => check.ok).length;
          return (
            <Panel
              key={group}
              title={group}
              meta={`${String(holding)} of ${String(rows.length)}`}
              flush
            >
              <ul className="divide-y divide-ink/[0.06] px-6 pb-3">
                {rows.map((check) => (
                  <CheckRow key={check.id} check={check} />
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
