import { liveRun, shortHash } from "../data/record.js";

const nav = ["Overview", "Mission Control", "Runs", "Verify", "Arena"];

export function AppShot() {
  return (
    <div className="w-full overflow-hidden rounded-md bg-white text-ink shadow-2xl ring-1 ring-black/5">
      <div className="flex">
        <aside className="hidden w-36 shrink-0 border-r border-line p-4 sm:block">
          <p className="mb-5 font-serif text-[18px]">Backstop</p>
          <ul className="space-y-2.5 text-[12px] text-ash">
            {nav.map((item) => (
              <li
                key={item}
                className={item === "Runs" ? "rounded bg-tile px-2 py-1 text-ink" : "px-2"}
              >
                {item}
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0 flex-1 p-4">
          <p className="text-[11px] text-ash">Runs / {liveRun.taskId}</p>
          <p className="mt-1 text-[15px] font-semibold">Settled on NEAR testnet</p>
          <p className="text-[11px] text-ash">
            Every row below is a transaction on vault.backstop-6501bb.testnet.
          </p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {liveRun.steps.map((step) => {
              const refused = step.outcome !== "success";
              return (
                <li key={step.txHash} className="flex items-center gap-3 py-2 text-[11px]">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${refused ? "bg-refused" : "bg-ok"}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{step.label}</span>
                  <span className="hidden font-mono text-ash sm:inline">
                    {shortHash(step.txHash)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
