import { useCallback, useEffect, useRef, useState } from "react";
import { Footer } from "../components/Footer.js";
import { Nav } from "../components/Nav.js";
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
  "Ledgers",
  "Transactions",
];

const expected =
  1 + 1 + 1 + record.runs.length + record.runs.reduce((total, run) => total + run.steps.length, 0);

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
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-[1100px] px-4 pt-28 pb-24 sm:px-10">
        <p className="text-[13px] text-ash">Verify it yourself</p>
        <h1 className="mt-3 max-w-2xl text-[30px] leading-tight font-medium tracking-tight text-balance">
          Your browser is re-reading NEAR testnet now and checking every claim in the public record.
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-ash">
          No backend and no wallet: the page calls a public NEAR RPC directly. Tamper with the
          record to see a check catch the lie.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <select
            value={tamper}
            onChange={(event) => {
              const next = tampers.find((item) => item.value === event.target.value);
              if (next !== undefined) setTamper(next.value);
            }}
            className="rounded-full border border-ink/20 bg-white px-4 py-2 text-[13px]"
          >
            {tampers.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              run(tamper);
            }}
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white"
          >
            Run again
          </button>
        </div>
        <div className="mt-12 flex items-end gap-6">
          <p className="font-serif text-[96px] leading-none">
            {passed}
            <span className="text-ash"> / {expected}</span>
          </p>
          <p className="pb-3 text-[14px] text-ash">
            {running
              ? "checking…"
              : error !== null
                ? `stopped: ${error}`
                : failed > 0
                  ? `${String(failed)} claim${failed === 1 ? "" : "s"} failed`
                  : unread > 0
                    ? `${String(unread)} could not be read from the RPC; run again`
                    : "every claim holds"}
          </p>
        </div>
        <div className="mt-2 h-px bg-line">
          <div
            className={`h-px transition-all ${failed > 0 ? "bg-refused" : "bg-ok"}`}
            style={{ width: `${String(Math.min(100, (checks.length / expected) * 100))}%` }}
          />
        </div>
        {groups.map((group) => {
          const rows = checks.filter((check) => check.group === group);
          if (rows.length === 0) return null;
          return (
            <section key={group} className="mt-12">
              <p className="mb-3 font-mono text-[11px] tracking-wider text-ash uppercase">
                {group}
              </p>
              <ul className="divide-y divide-line border-y border-line">
                {rows.map((check) => (
                  <li
                    key={check.id}
                    className="rise grid grid-cols-[18px_minmax(0,1fr)] gap-3 py-3"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 rounded-full ${check.ok ? "bg-ok" : check.unread === true ? "bg-ash" : "bg-refused"}`}
                    />
                    <div className="min-w-0">
                      <p className="text-[14px]">
                        {check.link === null ? (
                          check.label
                        ) : (
                          <a
                            href={check.link}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {check.label}
                          </a>
                        )}
                      </p>
                      <p className="truncate font-mono text-[11px] text-ash">{check.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>
      <Footer />
    </>
  );
}
