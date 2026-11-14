import { Kpi } from "../app/ui.js";
import { nearAmount } from "../data/near.js";
import type { AgentLine, ChainSteps, FeedEvent, Snapshot, Worker } from "./api.js";
import { AgentLogs, Feed } from "./Feed.js";
import { Agents, Chain, Evidence, Payouts } from "./Panels.js";

export type BoardData = {
  readonly taskId: string;
  readonly events: readonly FeedEvent[];
  readonly snapshot: Snapshot | null;
  readonly workers: readonly Worker[];
  readonly chain: ChainSteps | null;
  readonly lines: readonly AgentLine[];
};

const sentence = (state: string) =>
  state.charAt(0) + state.slice(1).toLowerCase().replaceAll("_", " ");

const near = (yocto: string | undefined) => (yocto === undefined ? "–" : nearAmount(yocto));

export function Board({ data }: { readonly data: BoardData }) {
  const task = data.snapshot?.task;
  const statement = data.snapshot?.statement;
  const network = data.chain?.network ?? null;
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          primary
          label="Task state"
          value={
            <span className="text-[20px] sm:text-[24px]">
              {task === undefined ? "–" : sentence(task.state)}
            </span>
          }
          note={
            task === undefined
              ? "waiting for the first event"
              : `attempt ${String(task.attempt)} · ${task.state}`
          }
        />
        <Kpi
          label="Paid in"
          value={near(statement?.totalIn)}
          unit="NEAR"
          note="escrow, premium and bond"
        />
        <Kpi
          label="Confirmed out"
          value={near(statement?.byStatus.CONFIRMED)}
          unit="NEAR"
          note={
            network === null ? "fixture vault, no NEAR moves" : `after NEAR ${network} callbacks`
          }
        />
        <Kpi
          label="Still held"
          value={near(statement?.held)}
          unit="NEAR"
          note={`${near(statement?.byStatus.PENDING)} NEAR pending`}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 lg:gap-6 xl:col-span-8">
          <Feed events={data.events} />
          <AgentLogs lines={data.lines} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 lg:gap-6 xl:col-span-4">
          <Agents workers={data.workers} excluded={task?.excludedAgents ?? []} />
          <Evidence snapshot={data.snapshot} />
          <Chain chain={data.chain} />
          <Payouts snapshot={data.snapshot} onChain={network} />
        </div>
      </div>
    </div>
  );
}
