import { buttonClass, Chip, PageHeader, Panel } from "../app/ui.js";
import { repository } from "../data/record.js";
import { TaskEditor } from "./TaskEditor.js";
import { JobMonitor } from "./JobMonitor.js";
import { useRepair } from "./useRepair.js";

export function RepairPage() {
  const repair = useRepair();
  const { config, job } = repair;
  return (
    <>
      <PageHeader
        eyebrow="Repair a function"
        title="Your task. Verified delivery."
        subtitle="Give the workers a broken JavaScript function and pinned tests. Follow execution, recovery and the contract’s final settlement."
        actions={<Chip tone="info">Live AI · testnet · team-funded</Chip>}
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Service and access" meta={config?.enabled ? "Available" : "Read-only"}>
          <p role="status" className="text-[13px] leading-relaxed text-ink/60">
            {repair.availability}
          </p>
          {!config?.enabled && (
            <p className="mt-3 text-[13px] leading-relaxed text-ink/60">
              Static hosting can display recorded evidence but cannot run workers. Start the repair
              service from the{" "}
              <a
                href={`${repository}/blob/main/docs/custom-repair.md`}
                target="_blank"
                rel="noreferrer"
                className="text-info underline"
              >
                local setup instructions
              </a>
              , then open the local web app.
            </p>
          )}
          <label htmlFor="repair-access" className="eyebrow mt-4 block text-ink/50">
            Operator-issued access code
          </label>
          <input
            id="repair-access"
            type="password"
            autoComplete="off"
            value={repair.token}
            onChange={(event) => {
              repair.setToken(event.target.value);
            }}
            className="mt-2 h-11 w-full rounded-xl bg-well px-3 text-[14px] outline-none focus:ring-2 focus:ring-ink/20"
          />
          <p className="mt-2 text-[12px] leading-relaxed text-ink/50">
            Kept only in this page’s memory. Never paste an AI-provider key or wallet key. Reloading
            clears the code.
          </p>
        </Panel>
        <Panel title="Bounded testnet policy" meta="No customer wallet charge">
          <dl className="grid grid-cols-2 gap-4 text-[13px]">
            <div>
              <dt className="text-ink/50">Escrow</dt>
              <dd className="mt-1 font-mono">{config?.budget.escrow ?? "0.40"} NEAR</dd>
            </div>
            <div>
              <dt className="text-ink/50">Premium</dt>
              <dd className="mt-1 font-mono">{config?.budget.premium ?? "0.04"} NEAR</dd>
            </div>
            <div>
              <dt className="text-ink/50">Guarantor bond</dt>
              <dd className="mt-1 font-mono">{config?.budget.bond ?? "0.25"} NEAR</dd>
            </div>
            <div>
              <dt className="text-ink/50">Compensation cap</dt>
              <dd className="mt-1 font-mono">{config?.budget.compensationCap ?? "0.10"} NEAR</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] leading-relaxed text-ink/50">
            These are policy limits, not confirmed deposits or payouts. The team supplies testnet
            funds and AI inference. Up to {config?.maxAttempts ?? 3} attempts; compensation is
            limited by remaining bond liability. Workers, coordinator and authorized verifier are
            team-controlled. Acceptance means the pinned tests passed, not universal correctness.
            {config?.maxJobsPerDay === undefined
              ? ""
              : ` Sponsorship is limited to ${String(config.maxJobsPerDay)} jobs per UTC day across this pilot.`}
          </p>
        </Panel>
      </div>
      {repair.error !== null && (
        <p role="alert" className="mb-4 rounded-xl bg-fail-bg p-4 text-[13px] text-fail">
          {repair.error}
        </p>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <TaskEditor
          disabled={repair.busy || repair.running}
          busy={repair.busy}
          canSubmit={config?.enabled === true && repair.token.trim() !== ""}
          onSubmit={repair.submit}
        />
        <div className="space-y-6">
          {job !== null && <JobMonitor job={job} token={repair.token} onError={repair.setError} />}
          <Panel title="Recent jobs" meta="Access-controlled">
            <button
              type="button"
              className={`${buttonClass.secondary} disabled:opacity-40`}
              disabled={repair.busy || repair.token.trim() === ""}
              onClick={() => {
                void repair.refresh();
              }}
            >
              Refresh job list
            </button>
            <ul className="mt-3 divide-y divide-ink/[0.06]">
              {repair.jobs.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-3 text-left text-[13px]"
                    onClick={() => {
                      repair.setJob(entry);
                    }}
                  >
                    <span className="truncate">{entry.objective}</span>
                    <Chip tone="neutral">{entry.status}</Chip>
                  </button>
                </li>
              ))}
            </ul>
            {repair.jobs.length === 0 && (
              <p className="mt-3 text-[13px] text-ink/50">
                Load existing jobs to resume monitoring after a refresh.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
