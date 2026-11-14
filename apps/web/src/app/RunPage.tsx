import { Link, useParams } from "react-router";
import { ledgerSchema, nearAmount, useVaultView } from "../data/near.js";
import {
  isRefusal,
  nearblocks,
  record,
  recordedOutcome,
  recoveryProofId,
  refundProofId,
  repository,
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
                  {nearAmount(row.amount, 24).replace(/0+$/u, "").replace(/\.$/u, "")} NEAR
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
          value={<span className="text-[20px] sm:text-[24px]">{recordedOutcome(run) ?? "–"}</span>}
          note="at the end of the recorded run"
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
        {runId === recoveryProofId && (
          <Panel
            title="Work recovered. Verified payout settled."
            meta="real NEAR testnet settlement"
            className="mb-6"
          >
            <p className="text-[14px] leading-relaxed text-ink/70">
              After the primary process was killed, the recovery patch passed the pinned checks. The
              worker received 0.0625 NEAR; 0.3775 NEAR returned to the customer and 0.25 NEAR to the
              guarantor. All 0.69 NEAR is reconciled below.
            </p>
            <Link
              to={`/app/runs/${refundProofId}`}
              className="mt-3 inline-block text-[13px] font-medium hover:underline"
            >
              Compare with the failed task refund →
            </Link>
          </Panel>
        )}
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
  return (
    <>
      {runId === refundProofId && (
        <Panel
          title="Task failed. Customer refunded."
          meta="real NEAR testnet settlement"
          className="mb-6"
        >
          <p className="text-[14px] leading-relaxed text-ink/70">
            Recovery did not deliver before the deadline. An observer finalized the expired task
            without the coordinator: 0.05 NEAR returned to the customer, and a duplicate refund was
            refused. This recorded task had no bond or compensation allowance, so compensation was 0
            NEAR. It proves the refund path; it does not prove a compensated failure.
          </p>
          <Link
            to={`/app/runs/${recoveryProofId}`}
            className="mt-3 inline-block text-[13px] font-medium hover:underline"
          >
            Compare with the successful recovery →
          </Link>
          <p className="mt-3 text-[13px] leading-relaxed text-ink/60">
            To inspect bounded compensation, run <code>pnpm episode exhausted</code>: a scripted
            fixture with simulated funds.{" "}
            <a
              href={`${repository}/blob/main/docs/independent-reproduction.md`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Reproduction guide
            </a>
            .
          </p>
        </Panel>
      )}
      <RecordView run={run} />
    </>
  );
}
