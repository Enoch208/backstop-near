import { Chip, Empty, Panel } from "../app/ui.js";
import { nearAmount } from "../data/near.js";
import { nearblocks, shortHash } from "../data/record.js";
import type { ChainSteps, Snapshot, Worker } from "./api.js";

function workerChip(worker: Worker) {
  if (worker.exit === null) return <Chip tone="pass">Running</Chip>;
  if (worker.exit.signal !== null) return <Chip tone="fail">{worker.exit.signal}</Chip>;
  return <Chip>Exit {String(worker.exit.code)}</Chip>;
}

export function Agents({
  workers,
  excluded,
}: {
  readonly workers: readonly Worker[];
  readonly excluded: readonly string[];
}) {
  return (
    <Panel title="Agent processes" meta={`${String(workers.length)} processes`}>
      {workers.length === 0 && <Empty>No processes yet.</Empty>}
      <ul className="divide-y divide-ink/[0.06]">
        {workers.map((worker) => (
          <li key={worker.agentId} className="flex min-h-11 items-center gap-3 py-2">
            <span className="flex-1 text-[14px] font-medium tracking-[-0.02em]">
              {worker.agentId}
              {excluded.includes(worker.agentId) && (
                <span className="ml-2 text-[12px] font-normal text-ink/50">excluded</span>
              )}
            </span>
            <span className="font-mono text-[12px] text-ink/40 tabular-nums">
              pid {String(worker.pid ?? "–")}
            </span>
            {workerChip(worker)}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function Payouts({
  snapshot,
  onChain,
}: {
  readonly snapshot: Snapshot | null;
  readonly onChain: string | null;
}) {
  const rows = Object.entries(snapshot?.statement.confirmedByRecipient ?? {});
  return (
    <Panel title="Confirmed payouts" meta={onChain === null ? "fixture vault" : `NEAR ${onChain}`}>
      {rows.length === 0 && <Empty>Nothing paid out yet.</Empty>}
      <ul className="divide-y divide-ink/[0.06]">
        {rows.map(([recipient, amount]) => (
          <li key={recipient} className="flex min-h-11 items-center justify-between gap-3 py-2">
            <span className="truncate text-[14px] tracking-[-0.02em] text-ink/70">
              {recipient.split(".")[0]}
            </span>
            <span className="font-mono text-[13px] tabular-nums">{nearAmount(amount)} NEAR</span>
          </li>
        ))}
      </ul>
      {onChain !== null && rows.length > 0 && (
        <p className="mt-3 text-[12px] leading-[1.5] text-ink/50">
          The orchestrator's ledger. On NEAR each payee is paid at its own sub-account; the
          transactions are listed above.
        </p>
      )}
    </Panel>
  );
}

export function Chain({ chain }: { readonly chain: ChainSteps | null }) {
  const network = chain?.network ?? null;
  const steps = chain?.steps ?? [];
  return (
    <Panel
      title={network === null ? "Vault" : `NEAR ${network}`}
      meta={network === null ? "fixture, no NEAR moves" : `${String(steps.length)} transactions`}
      flush
    >
      <ol className="scroll-thin max-h-[360px] overflow-y-auto px-6 pb-5">
        {steps.length === 0 && <Empty>No transactions yet.</Empty>}
        {steps.map((step) => (
          <li
            key={step.txHash}
            className="rise flex min-h-11 items-center gap-3 border-b border-ink/[0.05] py-2 last:border-0"
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${step.ok ? "bg-pass" : "bg-fail"}`}
            />
            <span className="min-w-0 flex-1 text-[13px] leading-[1.4] tracking-[-0.01em]">
              {step.label}
              {!step.ok && (
                <span className="mt-0.5 block font-mono text-[11px] text-fail">
                  refused {step.errorCode ?? ""}
                </span>
              )}
            </span>
            {network === "testnet" ? (
              <a
                href={nearblocks(step.txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] text-info hover:underline"
              >
                {shortHash(step.txHash).slice(0, 8)}
              </a>
            ) : (
              <span className="font-mono text-[12px] text-ink/40">
                {shortHash(step.txHash).slice(0, 8)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function Evidence({ snapshot }: { readonly snapshot: Snapshot | null }) {
  const evidence = snapshot?.task.candidate?.evidence ?? null;
  const inference = evidence?.body.inference;
  return (
    <Panel
      title="Verifier evidence"
      meta={evidence === null ? undefined : `attempt ${String(evidence.body.attempt)}`}
    >
      {evidence === null ? (
        <Empty>No submission under verification.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={evidence.body.verdict === "ACCEPT" ? "pass" : "fail"}>
              {evidence.body.verdict}
            </Chip>
            <span className="text-[13px] text-ink/60 tabular-nums">
              {evidence.body.totals.passed} passed · {evidence.body.totals.failed} failed
            </span>
          </div>
          <p className="truncate font-mono text-[12px] text-ink/50">{evidence.body.artifactHash}</p>
          {inference === undefined ? (
            <p className="text-[13px] text-ink/60">Scripted patch, so no AI receipt.</p>
          ) : (
            <p className="text-[13px] leading-[1.5] text-ink/80">
              Signed in NEAR AI's enclave by{" "}
              <span className="font-mono text-[12px]">
                {inference.signingAddress.slice(0, 10)}…
              </span>{" "}
              for {inference.model}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
