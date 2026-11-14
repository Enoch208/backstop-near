import type { ReactNode } from "react";
import { Link } from "react-router";
import { Mark } from "../components/Mark.js";
import { Pill } from "../components/Pill.js";
import type { AgentLine, ChainSteps, FeedEvent, Snapshot, Worker } from "./api.js";
import { Feed, Reasoning } from "./Feed.js";
import { Agents, Chain, Evidence, Money } from "./Panels.js";

export type BoardData = {
  readonly taskId: string;
  readonly events: readonly FeedEvent[];
  readonly snapshot: Snapshot | null;
  readonly workers: readonly Worker[];
  readonly chain: ChainSteps | null;
  readonly lines: readonly AgentLine[];
};

const stateTone = (state: string) =>
  /SETTLED/.test(state) ? "text-ok" : /FAIL|REJECT/.test(state) ? "text-refused" : "text-[#e8c07a]";

export function Shell({
  children,
  right,
}: {
  readonly children: ReactNode;
  readonly right?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink text-white">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2">
          <Mark className="h-5 w-5" />
          <span className="font-serif text-[22px] leading-none">Backstop</span>
          <span className="ml-3 hidden font-mono text-[11px] text-white/40 sm:inline">
            mission control
          </span>
        </Link>
        {right}
        <Pill to="/" tone="ghost">
          Overview
        </Pill>
      </header>
      {children}
    </div>
  );
}

export function TaskState({ taskId, state }: { readonly taskId: string; readonly state: string }) {
  return (
    <div className="flex items-center gap-4 font-mono text-[12px]">
      <span className="hidden text-white/50 md:inline">{taskId}</span>
      <span className={stateTone(state)}>{state}</span>
    </div>
  );
}

export function Board({ data }: { readonly data: BoardData }) {
  return (
    <main className="grid grid-cols-[minmax(0,1fr)] gap-px bg-white/10 lg:h-[calc(100vh-3.5rem)] lg:grid-cols-[300px_minmax(0,1fr)_380px]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-px bg-white/10">
        <Agents workers={data.workers} excluded={data.snapshot?.task.excludedAgents ?? []} />
        <Evidence snapshot={data.snapshot} />
      </div>
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] gap-px bg-white/10 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <Feed events={data.events} />
        <Reasoning lines={data.lines} />
      </div>
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] gap-px bg-white/10">
        <Money snapshot={data.snapshot} onChain={data.chain?.network ?? null} />
        <Chain chain={data.chain} />
      </div>
    </main>
  );
}
