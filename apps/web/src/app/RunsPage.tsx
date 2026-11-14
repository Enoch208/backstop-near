import { Link } from "react-router";
import { isRefusal, record, runKind, whenUtc, type RecordedRun } from "../data/record.js";
import { useRecordings } from "../live/replay.js";
import { Chip, PageHeader, Panel, type Tone } from "./ui.js";

const kindTone = (run: RecordedRun): Tone =>
  runKind(run) === "red team" ? "fail" : runKind(run) === "live swarm" ? "pass" : "neutral";

export function outcomeChip(run: RecordedRun) {
  if (run.ledgerState !== undefined)
    return <Chip tone={run.ledgerState === "SETTLED" ? "pass" : "warn"}>{run.ledgerState}</Chip>;
  const refused = run.steps.filter(isRefusal).length;
  return refused > 0 ? (
    <Chip tone="fail">{refused} refused</Chip>
  ) : (
    <Chip>{run.steps.length} ok</Chip>
  );
}

export function RunsPage() {
  const recordings = useRecordings() ?? [];
  const runs = [...record.runs].reverse();
  const head = "eyebrow px-3 pb-3 text-left font-normal text-ink/50 first:pl-0";
  return (
    <>
      <PageHeader
        eyebrow="Runs"
        title="Every task recorded on NEAR testnet."
        subtitle={`${String(record.runs.length)} runs against ${record.contractId}, newest first. Open one to replay it frame by frame or to read its transactions and its ledger from the vault.`}
      />
      <Panel title="Recorded runs" meta={`${String(record.runs.length)} runs`}>
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[720px] border-collapse text-[14px] tracking-[-0.02em]">
            <thead>
              <tr>
                <th className={head}>Run</th>
                <th className={head}>Kind</th>
                <th className={head}>Recorded</th>
                <th className={`${head} text-right`}>Transactions</th>
                <th className={head}>Outcome</th>
                <th className={`${head} text-right`}>Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.06] border-t border-ink/[0.06]">
              {runs.map((run) => (
                <tr key={run.taskId} className="h-12">
                  <td className="pr-3">
                    <Link
                      to={`/app/runs/${run.taskId}`}
                      className="font-mono text-[13px] hover:underline"
                    >
                      {run.taskId}
                    </Link>
                  </td>
                  <td className="px-3">
                    <Chip tone={kindTone(run)}>{runKind(run)}</Chip>
                  </td>
                  <td className="px-3 text-ink/60 tabular-nums">{whenUtc(run.at)}</td>
                  <td className="px-3 text-right tabular-nums">{run.steps.length}</td>
                  <td className="px-3">{outcomeChip(run)}</td>
                  <td className="pl-3 text-right">
                    <Link
                      to={`/app/runs/${run.taskId}`}
                      className="text-[13px] font-medium text-ink hover:underline"
                    >
                      {recordings.includes(run.taskId) ? "Replay" : "Transactions"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
