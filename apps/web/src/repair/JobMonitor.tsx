import { buttonClass, Chip, Panel } from "../app/ui.js";
import { downloadArtifact, type RepairJob } from "./client.js";
import { faultLabels } from "./TaskEditor.js";
import { nearAmount, repairReportSchema } from "./report.js";

const txLink = (hash: string) => `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;

export function JobMonitor({
  job,
  token,
  onError,
}: {
  readonly job: RepairJob;
  readonly token: string;
  readonly onError: (error: string | null) => void;
}) {
  const parsed = job.report === null ? null : repairReportSchema.safeParse(job.report);
  const report = parsed?.success ? parsed.data : null;
  const title =
    report?.state === "SETTLED" && report.verified
      ? "Verified work settled"
      : report?.state === "FAILURE_SETTLED"
        ? "Failure settlement recorded"
        : "Run progress";
  async function download() {
    try {
      await downloadArtifact(job, token);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Artifact download failed.");
    }
  }
  return (
    <Panel
      title={title}
      meta={<Chip tone={job.status === "interrupted" ? "fail" : "neutral"}>{job.status}</Chip>}
    >
      <p className="break-all font-mono text-[12px] text-ink/60">{job.id}</p>
      <p className="mt-2 text-[13px]">{job.objective}</p>
      <p className="mt-2 text-[12px] text-ink/50">{faultLabels[job.fault]}</p>
      {job.status === "running" && (
        <p role="status" className="mt-4 text-[13px] text-ink/60">
          Execution is in progress. Allow up to five minutes plus chain confirmations. No accepted
          artifact or confirmed payout is reported yet.
        </p>
      )}
      {job.error !== null && (
        <p role="alert" className="mt-4 text-[13px] text-fail">
          {job.error}
        </p>
      )}
      {parsed !== null && !parsed.success && (
        <p role="alert" className="mt-4 text-[13px] text-fail">
          The final report did not match the expected evidence format. Settlement cannot be
          displayed as verified.
        </p>
      )}
      {report !== null && (
        <div className="mt-4 space-y-4">
          <dl className="space-y-2 text-[13px]">
            <div>
              <dt className="text-ink/50">Task</dt>
              <dd className="break-all font-mono">{report.taskId}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Vault</dt>
              <dd>
                <a
                  className="break-all font-mono text-info hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://testnet.nearblocks.io/address/${encodeURIComponent(report.vaultId)}`}
                >
                  {report.vaultId}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-ink/50">Artifact verification</dt>
              <dd>
                {report.state === "SETTLED" && report.verified && report.artifactHash !== undefined
                  ? "Accepted by the authorized verifier’s pinned checks"
                  : "No verified delivery"}
              </dd>
            </div>
            {report.artifactHash !== undefined && (
              <div>
                <dt className="text-ink/50">Artifact hash</dt>
                <dd className="break-all font-mono text-[11px]">{report.artifactHash}</dd>
              </div>
            )}
            <div>
              <dt className="text-ink/50">Live model</dt>
              <dd className="break-all">{report.model}</dd>
            </div>
          </dl>
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-page p-4 text-[12px]">
            <div>
              <p className="text-ink/50">Total inflow</p>
              <p className="mt-1 font-mono">{nearAmount(report.ledger.total_inflow)}</p>
            </div>
            <div>
              <p className="text-ink/50">Confirmed outflow</p>
              <p className="mt-1 font-mono">{nearAmount(report.ledger.confirmed_outflow)}</p>
            </div>
            <div>
              <p className="text-ink/50">Customer refund</p>
              <p className="mt-1 font-mono">{nearAmount(report.ledger.customer_refund)}</p>
            </div>
            <div>
              <p className="text-ink/50">Compensation</p>
              <p className="mt-1 font-mono">{nearAmount(report.ledger.compensation)}</p>
            </div>
          </div>
          <p className="text-[12px] text-ink/60">
            Amounts above come from the final testnet ledger. Refund and compensation are separate;
            the compensation cap is not a promised payout.
          </p>
          {job.artifactAvailable && report.state === "SETTLED" && report.verified && (
            <button
              type="button"
              className={buttonClass.primary}
              onClick={() => {
                void download();
              }}
            >
              Download verified JavaScript
            </button>
          )}
          {report.checks !== undefined && (
            <div>
              <dt className="text-ink/50">Pinned checks</dt>
              <dd>
                {report.checks.passed} / {report.checks.total} passed
              </dd>
            </div>
          )}
          {report.evidenceHash !== undefined && (
            <div>
              <dt className="text-ink/50">Evidence hash</dt>
              <dd className="break-all font-mono text-[11px]">{report.evidenceHash}</dd>
            </div>
          )}
          {report.suiteHash !== undefined && (
            <div>
              <dt className="text-ink/50">Suite hash</dt>
              <dd className="break-all font-mono text-[11px]">{report.suiteHash}</dd>
            </div>
          )}
          <ol className="divide-y divide-ink/[0.06]">
            {report.transactions.map((tx, index) => (
              <li
                key={`${tx.txHash}-${String(index)}`}
                className="flex items-start justify-between gap-3 py-2 text-[12px]"
              >
                <span>
                  {tx.label}
                  <span className="mt-1 block text-ink/50">
                    {tx.ok
                      ? "Transaction succeeded"
                      : tx.refusalExpected
                        ? "Expected refusal"
                        : "Transaction failed"}
                  </span>
                </span>
                <a
                  className="shrink-0 font-mono text-info hover:underline"
                  href={txLink(tx.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tx.txHash.slice(0, 8)} ↗
                </a>
              </li>
            ))}
          </ol>
          <p
            className={`text-[12px] ${report.duplicateSettlement.rejected ? "text-ink/60" : "text-fail"}`}
          >
            Duplicate settlement{" "}
            {report.duplicateSettlement.rejected ? "refused" : "not proven refused"}:{" "}
            {report.duplicateSettlement.errorCode ?? "no error code"}.{" "}
            <a
              className="text-info underline"
              href={txLink(report.duplicateSettlement.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              Inspect transaction
            </a>
          </p>
          <details>
            <summary className="cursor-pointer text-[12px] text-ink/60">
              Final evidence report
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-well p-3 font-mono text-[11px]">
              {JSON.stringify(job.report, null, 2)}
            </pre>
          </details>
        </div>
      )}
      <details open={job.status === "running"} className="mt-5">
        <summary className="cursor-pointer text-[13px] font-medium">
          Worker and settlement logs
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-well p-3 font-mono text-[11px] leading-relaxed">
          {job.logs.length === 0 ? "Waiting for execution output…" : job.logs.join("\n")}
        </pre>
      </details>
    </Panel>
  );
}
