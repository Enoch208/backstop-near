import { Link } from "react-router";
import {
  attestedStep,
  enclaveKey,
  isRefusal,
  nearblocks,
  nearblocksAccount,
  record,
  recoveryProofId,
  refundProofId,
  runKind,
  shortHash,
  whenUtc,
} from "../data/record.js";
import { Icon, type IconName } from "./icons.js";
import { OutcomeProofs } from "./OutcomeProofs.js";
import { outcomeChip } from "./RunsPage.js";
import { buttonClass, Kpi, PageHeader, Panel } from "./ui.js";

const steps = record.runs.flatMap((run) => run.steps);
const refused = steps.filter(isRefusal).length;
const attested = record.runs.filter((run) => attestedStep(run) !== undefined).length;
const latest = [...record.runs].reverse().find((run) => runKind(run) === "live swarm");
const upgrade = record.upgrades.at(-1);

const explore: readonly { to: string; icon: IconName; title: string; body: string }[] = [
  {
    to: "/app/live",
    icon: "live",
    title: "Mission Control",
    body: "Follow a run on your machine: processes, events, agent logs, verdict, ledger.",
  },
  {
    to: "/app/runs",
    icon: "runs",
    title: "Runs",
    body: "Every task recorded on testnet, with replays and on-chain ledgers.",
  },
  {
    to: "/app/verify",
    icon: "verify",
    title: "Verify",
    body: "Your browser re-checks every claim against NEAR, and catches a tampered one.",
  },
  {
    to: "/app/arena",
    icon: "arena",
    title: "Arena",
    body: "32 seeded fault cases in six modes, with the challenger, market and bond switched off.",
  },
];

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 flex-col justify-center gap-1 py-2.5">
      <dt className="eyebrow text-ink/50">{label}</dt>
      <dd className="truncate font-mono text-[12px] text-ink/80">{children}</dd>
    </div>
  );
}

export function Overview() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Verified work. Bounded recourse."
        subtitle="Agents finish verified work, or the customer receives the contract’s bounded refund and compensation. Inspect both recorded outcomes below, with the limits of each proof made explicit."
        actions={
          <>
            <Link to="/app/repair" className={buttonClass.primary}>
              Repair your function
            </Link>
            <Link to={`/app/runs/${recoveryProofId}`} className={buttonClass.primary}>
              Work recovered
            </Link>
            <Link to={`/app/runs/${refundProofId}`} className={buttonClass.secondary}>
              Failed task refunded
            </Link>
          </>
        }
      />
      <OutcomeProofs />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi primary label="Recorded runs" value={record.runs.length} note="on NEAR testnet" />
        <Kpi
          label="Transactions"
          value={steps.length}
          note={`${String(refused)} refused by the vault, as designed`}
        />
        <Kpi
          label="Attested AI receipts"
          value={attested}
          note="provenance checked; tests decide acceptance"
        />
        <Kpi
          label="Enclave key"
          value={
            <span className="font-mono text-[18px] tracking-normal sm:text-[20px]">
              {enclaveKey.signingAddress.slice(0, 6)}…{enclaveKey.signingAddress.slice(-4)}
            </span>
          }
          note={enclaveKey.model}
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-6 lg:grid-cols-12 lg:gap-6">
        {latest !== undefined && (
          <Panel
            title="Latest live run"
            meta={whenUtc(latest.at)}
            className="lg:col-span-7 xl:col-span-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <Link
                to={`/app/runs/${latest.taskId}`}
                className="font-mono text-[14px] hover:underline"
              >
                {latest.taskId}
              </Link>
              {outcomeChip(latest)}
            </div>
            <ol className="divide-y divide-ink/[0.06] border-t border-ink/[0.06]">
              {latest.steps.map((step) => (
                <li key={step.txHash} className="flex min-h-11 items-center gap-3 py-2">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${isRefusal(step) ? "bg-fail" : "bg-pass"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px] tracking-[-0.02em]">
                    {step.label}
                  </span>
                  <a
                    href={nearblocks(step.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[12px] text-info hover:underline"
                  >
                    {shortHash(step.txHash).slice(0, 8)}
                  </a>
                </li>
              ))}
            </ol>
          </Panel>
        )}
        <Panel title="Vault" meta="NEAR testnet" className="lg:col-span-5 xl:col-span-4">
          <dl className="divide-y divide-ink/[0.06]">
            <Fact label="Contract">
              <a
                href={nearblocksAccount(record.contractId)}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {record.contractId}
              </a>
            </Fact>
            {upgrade !== undefined && (
              <Fact label="Code hash">
                <a
                  href={nearblocks(upgrade.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {upgrade.to}
                </a>
              </Fact>
            )}
            <Fact label="Enclave key registered">
              <a
                href={nearblocks(enclaveKey.txHash)}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {enclaveKey.signingAddress}
              </a>
            </Fact>
            <Fact label="Intel TDX status">{enclaveKey.tcbStatus ?? "not recorded"}</Fact>
          </dl>
        </Panel>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-6 lg:grid-cols-4">
        {explore.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group flex flex-col gap-6 rounded-xl bg-surface p-5 transition-colors duration-150 hover:bg-white/70"
          >
            <span className="text-ink/60 group-hover:text-ink">
              <Icon name={item.icon} size={20} />
            </span>
            <span>
              <span className="block text-[15px] font-medium tracking-[-0.02em]">{item.title}</span>
              <span className="mt-1.5 block text-[13px] leading-[1.5] text-ink/60">
                {item.body}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
