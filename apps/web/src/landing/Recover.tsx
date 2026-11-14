import { Accordion } from "../components/Accordion.js";
import { Pill } from "../components/Pill.js";
import { AppShot } from "./AppShot.js";

const folds = [
  {
    title: "A dead agent loses its lease",
    body: "Every worker holds a fenced lease and must keep beating. The judge sends a real SIGKILL; the heartbeats stop, the lease lapses, and any late write from the dead process is refused with STALE_LEASE.",
  },
  {
    title: "The market re-auctions the work",
    body: "Other agents bid on their own to finish from the last checkpoint. The cheapest eligible bid within escrow plus the guarantor's liability wins; anyone who already failed this task is excluded.",
  },
  {
    title: "Coalitions form by consent",
    body: "A lead can propose a team with explicit payout shares, but the bid enters the auction only after every member co-signs its own seat with its own key.",
  },
];

export function Recover() {
  return (
    <section
      id="recover"
      className="mx-auto grid max-w-[1440px] items-center gap-12 px-4 py-28 sm:px-10 lg:grid-cols-[1.6fr_1fr]"
    >
      <div className="relative flex min-h-[460px] items-center justify-end overflow-hidden bg-ink">
        <div className="photo photo-recover absolute inset-y-0 left-0 w-1/5" />
        <div className="relative w-[88%] py-14">
          <AppShot />
        </div>
      </div>
      <div className="max-w-md">
        <p className="text-[13px] text-ash">Recover</p>
        <h2 className="mt-4 text-[26px] leading-tight font-medium tracking-tight">
          Kill the agent. The swarm finishes the job, and nobody tells it to.
        </h2>
        <div className="mt-7 flex flex-wrap gap-2">
          <Pill to="/live">Watch it live</Pill>
          <Pill to="#settlement" tone="ghost-dark">
            See the payout
          </Pill>
        </div>
        <Accordion folds={folds} />
      </div>
    </section>
  );
}
