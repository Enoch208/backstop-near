import { useParams } from "react-router";
import { ledgerSchema, nearAmount, useVaultView } from "../data/near.js";
import {
  isRefusal,
  nearblocks,
  record,
  runKind,
  shortHash,
  whenUtc,
  type RecordedRun,
} from "../data/record.js";
import { ReplayView } from "../live/Live.js";
import { useRecordings } from "../live/replay.js";
import { outcomeChip } from "./RunsPage.js";
import { Chip, Empty, Kpi, PageHeader, Panel } from "./ui.js";

export function ChainLedger({ taskId }: { readonly taskId: string }) {
  const reading = useVaultView("get_ledger", { task_id: taskId }, ledgerSchema);
  return (
    <Panel title="Ledger on the vault now" meta="read in your browser">
      {reading.status === "loading" && <Empty>Reading get_ledger from NEAR testnet…</Empty>}
      {reading.status === "failed" && <Empty>The RPC did not answer: {reading.message}</Empty>}
      {reading.status === "ok" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={reading.value.state === "SETTLED" ? "pass" : "warn"}>
              {reading.value.state}
            </Chip>
            <span className="text-[13px] text-ink/60 tabular-nums">
              {nearAmount(reading.value.total_inflow)} NEAR in ·{" "}
              {nearAmount(reading.value.confirmed_outflow)} NEAR confirmed out
            </span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {reading.value.confirmed_by_recipient.map((row) => (
              <li
                key={row.recipient}
                className="flex min-h-11 items-center justify-between gap-3 py-2"
              >
                <span className="truncate font-mono text-[12px] text-ink/70">{row.recipient}</span>
                <span className="font-mono text-[13px] tabular-nums">
                  {nearAmount(row.amount)} NEAR
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Transactions({ run }: { readonly run: RecordedRun }) {
  return (
    <Panel title="Transactions" meta={`${String(run.steps.length)} on ${record.contractId}`}>
      <ol className="divide-y divide-ink/[0.06]">
        {run.steps.map((step) => (
          <li key={step.txHash} className="flex min-h-12 items-center gap-3 py-2.5">
            <Chip tone={isRefusal(step) ? "fail" : "pass"}>
              {isRefusal(step) ? "Refused" : "Ok"}
            </Chip>
            <span className="min-w-0 flex-1 text-[14px] leading-[1.4] tracking-[-0.02em]">
              {step.label}
              {isRefusal(step) && (
                <span className="mt-0.5 block font-mono text-[11px] text-fail">{step.outcome}</span>
              )}
            </span>
            <a
              href={nearblocks(step.txHash)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12px] text-info hover:underline"
            >
              {shortHash(step.txHash)}
            </a>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function RecordView({ run }: { readonly run: RecordedRun }) {
  const refused = run.steps.filter(isRefusal).length;
  return (
    <>
      <PageHeader
        eyebrow={`Run · ${runKind(run)}`}
        title={run.taskId}
        subtitle={`Recorded on NEAR testnet on ${whenUtc(run.at)}. Every row links to its transaction, and the ledger is read from the vault in your browser.`}
        actions={outcomeChip(run)}
      />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:mb-6 lg:grid-cols-4">
        <Kpi
          primary
          label="Transactions"
          value={run.steps.length}
          note="each one links to NearBlocks"
        />
        <Kpi
          label="Refused on chain"
          value={refused}
          note={refused > 0 ? "attacks the vault rejected" : "none needed"}
        />
        <Kpi
          label="Primary agent"
          value={run.primaryExit?.signal ?? "–"}
          note={
            run.primaryExit === undefined ? "not a live swarm run" : "how alpha's process ended"
          }
        />
        <Kpi
          label="Recorded ledger"
          value={<span className="text-[20px] sm:text-[24px]">{run.ledgerState ?? "–"}</span>}
          note="at the end of the run"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="min-w-0 lg:col-span-7 xl:col-span-8">
          <Transactions run={run} />
        </div>
        <div className="min-w-0 lg:col-span-5 xl:col-span-4">
          <ChainLedger taskId={run.taskId} />
        </div>
      </div>
    </>
  );
}

export function RunPage() {
  const { runId = "" } = useParams();
  const recordings = useRecordings();
  const run = record.runs.find((entry) => entry.taskId === runId);
  if (recordings === null) return null;
  if (recordings.includes(runId))
    return (
      <>
        <ReplayView runId={runId} />
        {run !== undefined && (
          <div className="mt-4 lg:mt-6">
            <ChainLedger taskId={runId} />
          </div>
        )}
      </>
    );
  if (run === undefined)
    return (
      <PageHeader
        eyebrow="Runs"
        title="No such run."
        subtitle={`${runId} is not in the testnet record.`}
      />
    );
  return <RecordView run={run} />;
}
