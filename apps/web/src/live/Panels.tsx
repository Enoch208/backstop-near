import { nearAmount } from "../data/near.js";
import { nearblocks, shortHash } from "../data/record.js";
import type { ChainSteps, Snapshot, Worker } from "./api.js";

const label =
  "border-b border-white/10 px-4 py-3 font-mono text-[11px] tracking-wider text-white/40 uppercase";

function workerState(worker: Worker) {
  if (worker.exit === null) return { text: "running", tone: "text-ok" };
  if (worker.exit.signal !== null) return { text: worker.exit.signal, tone: "text-refused" };
  return { text: `exit ${String(worker.exit.code)}`, tone: "text-white/50" };
}

export function Agents({
  workers,
  excluded,
}: {
  readonly workers: readonly Worker[];
  readonly excluded: readonly string[];
}) {
  return (
    <section className="bg-coal">
      <p className={label}>Agent processes</p>
      {workers.length === 0 && (
        <p className="px-4 py-4 text-[12px] text-white/40">No processes yet.</p>
      )}
      <ul className="divide-y divide-white/5">
        {workers.map((worker) => {
          const state = workerState(worker);
          return (
            <li
              key={worker.agentId}
              className="flex items-center justify-between px-4 py-2.5 text-[13px]"
            >
              <span>
                {worker.agentId}
                {excluded.includes(worker.agentId) && (
                  <span className="ml-2 font-mono text-[10px] text-refused">excluded</span>
                )}
              </span>
              <span className="font-mono text-[11px] text-white/40">
                pid {String(worker.pid ?? "–")}
              </span>
              <span className={`font-mono text-[11px] ${state.tone}`}>{state.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Money({
  snapshot,
  onChain,
}: {
  readonly snapshot: Snapshot | null;
  readonly onChain: string | null;
}) {
  const statement = snapshot?.statement;
  return (
    <section className="bg-coal">
      <p className={label}>Ledger</p>
      <div className="grid grid-cols-2 gap-px bg-white/5">
        {[
          { name: "Paid in", value: statement?.totalIn },
          { name: "Confirmed out", value: statement?.byStatus.CONFIRMED },
          { name: "Held", value: statement?.held },
          { name: "Pending", value: statement?.byStatus.PENDING },
        ].map((cell) => (
          <div key={cell.name} className="bg-coal px-4 py-4">
            <p className="text-[11px] text-white/40">{cell.name}</p>
            <p className="mt-1 font-serif text-[34px] leading-none">
              {cell.value === undefined ? "–" : nearAmount(cell.value)}
            </p>
          </div>
        ))}
      </div>
      {onChain !== null && (
        <p className="px-4 pt-3 text-[11px] leading-relaxed text-white/40">
          Orchestrator ledger. On NEAR {onChain}, each payee is paid at its own sub-account; the
          transactions are below.
        </p>
      )}
      <ul className="divide-y divide-white/5 px-4 py-2">
        {Object.entries(statement?.confirmedByRecipient ?? {}).map(([recipient, amount]) => (
          <li key={recipient} className="flex justify-between py-1.5 text-[12px]">
            <span className="truncate text-white/60">{recipient}</span>
            <span className="font-mono">{nearAmount(amount)} NEAR</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Chain({ chain }: { readonly chain: ChainSteps | null }) {
  const testnet = chain?.network === "testnet";
  return (
    <section className="flex min-h-0 flex-col bg-coal">
      <p className={label}>
        {chain?.network === null || chain === null
          ? "Vault · fixture mode, no NEAR moves"
          : `NEAR ${chain.network} transactions`}
      </p>
      <ol className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {(chain?.steps ?? []).map((step) => (
          <li key={step.txHash} className="rise flex items-center gap-3 py-1.5 text-[12px]">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${step.ok ? "bg-ok" : "bg-refused"}`}
            />
            <span className="min-w-0 flex-1 truncate text-white/80">{step.label}</span>
            {testnet ? (
              <a
                href={nearblocks(step.txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-ok hover:underline"
              >
                {shortHash(step.txHash)}
              </a>
            ) : (
              <span className="font-mono text-[11px] text-white/40">{shortHash(step.txHash)}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Evidence({ snapshot }: { readonly snapshot: Snapshot | null }) {
  const evidence = snapshot?.task.candidate?.evidence ?? null;
  const inference = evidence?.body.inference;
  return (
    <section className="bg-coal">
      <p className={label}>Verifier evidence</p>
      {evidence === null ? (
        <p className="px-4 py-4 text-[12px] text-white/40">No submission under verification.</p>
      ) : (
        <div className="space-y-2 px-4 py-4 text-[12px]">
          <p>
            <span className={evidence.body.verdict === "ACCEPT" ? "text-ok" : "text-refused"}>
              {evidence.body.verdict}
            </span>
            <span className="text-white/50">
              {" "}
              · attempt {evidence.body.attempt} · {evidence.body.totals.passed} passed,{" "}
              {evidence.body.totals.failed} failed
            </span>
          </p>
          <p className="truncate font-mono text-white/40">{evidence.body.artifactHash}</p>
          {inference === undefined ? (
            <p className="text-white/40">Scripted patch: no AI receipt.</p>
          ) : (
            <p className="text-white/70">
              TEE-signed by{" "}
              <span className="font-mono">{inference.signingAddress.slice(0, 10)}…</span> for{" "}
              {inference.model}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
