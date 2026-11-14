import { useSearchParams } from "react-router";
import { Mark } from "../components/Mark.js";
import { Pill } from "../components/Pill.js";
import {
  chainSchema,
  snapshotSchema,
  useEvents,
  useLatestTask,
  usePolled,
  workersSchema,
} from "./api.js";
import { Feed } from "./Feed.js";
import { Agents, Chain, Evidence, Money } from "./Panels.js";

function Waiting({ reachable }: { readonly reachable: boolean }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-32 text-center">
      <h1 className="font-serif text-[48px] leading-none">
        {reachable ? "No run yet." : "The API is not running."}
      </h1>
      <p className="mt-6 text-[14px] leading-relaxed text-white/60">
        Start the live swarm in a terminal and this page follows it as it happens. Add
        <span className="font-mono"> --chain testnet</span> to settle on NEAR testnet.
      </p>
      <pre className="mt-6 inline-block rounded bg-coal px-5 py-3 text-left font-mono text-[13px] text-ok">
        pnpm demo --hold
      </pre>
    </div>
  );
}

export function Live() {
  const [params] = useSearchParams();
  const latest = useLatestTask(params.get("task"));
  const taskId = latest.taskId;
  const base = taskId === null ? null : `/api/tasks/${encodeURIComponent(taskId)}`;
  const snapshot = usePolled(base, snapshotSchema, 800);
  const workers = usePolled(taskId === null ? null : "/api/workers", workersSchema, 1000);
  const chain = usePolled(base === null ? null : `${base}/chain`, chainSchema, 1500);
  const events = useEvents(taskId);
  const state = snapshot.value?.task.state ?? "–";
  const taskWorkers = (workers.value?.workers ?? []).filter((worker) => worker.taskId === taskId);
  return (
    <div className="min-h-screen bg-ink text-paper">
      <header className="flex h-14 items-center justify-between border-b border-white/10 px-4 sm:px-8">
        <a href="/" className="flex items-center gap-2">
          <Mark className="h-5 w-5" />
          <span className="font-serif text-[22px] leading-none">Backstop</span>
          <span className="ml-3 font-mono text-[11px] text-white/40">mission control</span>
        </a>
        {taskId !== null && (
          <div className="flex items-center gap-4 font-mono text-[12px]">
            <span className="hidden text-white/50 sm:inline">{taskId}</span>
            <span
              className={
                /SETTLED/.test(state)
                  ? "text-ok"
                  : /FAIL|REJECT/.test(state)
                    ? "text-refused"
                    : "text-[#e8c07a]"
              }
            >
              {state}
            </span>
          </div>
        )}
        <Pill to="/" tone="ghost">
          Overview
        </Pill>
      </header>
      {taskId === null ? (
        <Waiting reachable={latest.reachable} />
      ) : (
        <main className="grid gap-px bg-white/10 lg:h-[calc(100vh-3.5rem)] lg:grid-cols-[300px_1fr_380px]">
          <div className="grid content-start gap-px bg-white/10">
            <Agents workers={taskWorkers} excluded={snapshot.value?.task.excludedAgents ?? []} />
            <Evidence snapshot={snapshot.value} />
          </div>
          <Feed events={events} />
          <div className="grid min-h-0 grid-rows-[auto_1fr] gap-px bg-white/10">
            <Money snapshot={snapshot.value} />
            <Chain chain={chain.value} />
          </div>
        </main>
      )}
    </div>
  );
}
