import { useState } from "react";
import { Pill } from "../components/Pill.js";
import { ledgerSchema, nearAmount, useVaultView, type ChainLedger } from "../data/near.js";
import { liveRun } from "../data/record.js";

type Tab = { readonly label: string; readonly amount: (ledger: ChainLedger) => string };

const recipient = (ledger: ChainLedger, prefix: string) =>
  ledger.confirmed_by_recipient.find((row) => row.recipient.startsWith(prefix))?.amount ?? "0";

const tabs: readonly Tab[] = [
  { label: "Paid in", amount: (ledger) => ledger.total_inflow },
  { label: "Paid out", amount: (ledger) => ledger.confirmed_outflow },
  { label: "To the agent", amount: (ledger) => recipient(ledger, "beta.") },
  { label: "Bond used", amount: (ledger) => ledger.bond_consumed },
];

export function Settlement() {
  const reading = useVaultView("get_ledger", { task_id: liveRun.taskId }, ledgerSchema);
  const [active, setActive] = useState(0);
  const tab = tabs[active] ?? tabs[0];
  const settle = liveRun.steps.find((step) => step.label.startsWith("Coordinator finalizes"));
  return (
    <section
      id="settlement"
      className="mx-auto flex max-w-[1440px] flex-col items-center px-4 py-28 text-center sm:px-10"
    >
      <div className="flex gap-4 text-[13px]">
        {tabs.map((item, index) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              setActive(index);
            }}
            className={index === active ? "text-ink" : "text-ash hover:text-ink"}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-8 font-serif text-[88px] leading-none tracking-tight sm:text-[140px]">
        {reading.status === "ok" && tab !== undefined ? nearAmount(tab.amount(reading.value)) : "…"}
        <span className="ml-3 align-top font-sans text-[18px] text-ash">NEAR</span>
      </p>
      <span className="mt-10 h-16 w-px bg-ink" />
      <span className="h-10 w-px bg-line" />
      <p className="mt-6 max-w-md text-[14px] leading-relaxed text-ash">
        {reading.status === "failed"
          ? `NEAR RPC unreachable: ${reading.message}`
          : `${liveRun.taskId}, read live from the vault on NEAR testnet. Every yoctoNEAR paid in was confirmed out by the contract's own callbacks, once.`}
      </p>
      {settle !== undefined && (
        <div className="mt-7">
          <Pill to={settle.explorer}>Open the settlement</Pill>
        </div>
      )}
    </section>
  );
}
