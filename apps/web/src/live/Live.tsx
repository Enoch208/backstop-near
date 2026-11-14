import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  chainSchema,
  snapshotSchema,
  useEvents,
  useLatestTask,
  usePolled,
  workersSchema,
} from "./api.js";
import { asset } from "../data/base.js";
import { Board, Shell, TaskState } from "./Board.js";
import { runIndexSchema, useReplay } from "./replay.js";

function useLatestRecording() {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    fetch(asset("runs/index.json"))
      .then(async (response) => (response.ok ? runIndexSchema.parse(await response.json()) : []))
      .then((runs) => {
        setLatest(runs.at(-1)?.taskId ?? null);
      })
      .catch(() => {
        setLatest(null);
      });
  }, []);
  return latest;
}

function Waiting({
  reachable,
  recording,
}: {
  readonly reachable: boolean;
  readonly recording: string | null;
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-28 text-center">
      <h1 className="font-serif text-[44px] leading-none">
        {reachable ? "No run yet." : "Watch a real run."}
      </h1>
      {recording !== null && (
        <div className="mt-8">
          <Link
            to={`/live?replay=${recording}`}
            className="inline-flex rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-ink"
          >
            Replay the recorded NEAR testnet run
          </Link>
          <p className="mt-3 text-[13px] text-white/50">
            The real event log and transactions of {recording}, played back. No install, no wallet.
          </p>
        </div>
      )}
      <p className="mt-10 text-[14px] leading-relaxed text-white/60">
        Or run the swarm yourself and this page follows it live:
      </p>
      <pre className="mt-4 inline-block rounded bg-coal px-5 py-3 text-left font-mono text-[13px] text-ok">
        pnpm web{"\n"}pnpm demo --hold
      </pre>
    </div>
  );
}

function LiveView({ preferred }: { readonly preferred: string | null }) {
  const latest = useLatestTask(preferred);
  const recording = useLatestRecording();
  const taskId = latest.taskId;
  const base = taskId === null ? null : `/api/tasks/${encodeURIComponent(taskId)}`;
  const snapshot = usePolled(base, snapshotSchema, 800);
  const workers = usePolled(taskId === null ? null : "/api/workers", workersSchema, 1000);
  const chain = usePolled(base === null ? null : `${base}/chain`, chainSchema, 1500);
  const events = useEvents(taskId);
  if (taskId === null)
    return (
      <Shell>
        <Waiting reachable={latest.reachable} recording={recording} />
      </Shell>
    );
  return (
    <Shell right={<TaskState taskId={taskId} state={snapshot.value?.task.state ?? "–"} />}>
      <Board
        data={{
          taskId,
          events,
          snapshot: snapshot.value,
          workers: (workers.value?.workers ?? []).filter((worker) => worker.taskId === taskId),
          chain: chain.value,
        }}
      />
    </Shell>
  );
}

const speeds = [1, 2, 4];

function ReplayView({ runId }: { readonly runId: string }) {
  const [speed, setSpeed] = useState(2);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const replay = useReplay(runId, speed, startedAt);
  const run = replay.run;
  const right = (
    <div className="flex items-center gap-3 font-mono text-[11px]">
      <span className="rounded bg-[#e8c07a]/15 px-2 py-1 text-[#e8c07a]">REPLAY</span>
      <span className="hidden text-white/50 lg:inline">
        {run === null
          ? runId
          : `recorded ${run.recordedAt.slice(0, 10)} on NEAR ${run.network} · every tx link is real`}
      </span>
      {speeds.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            setStartedAt(Date.now());
            setSpeed(value);
          }}
          className={value === speed ? "text-white" : "text-white/40 hover:text-white"}
        >
          {value}×
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setStartedAt(Date.now());
        }}
        className="text-white/60 hover:text-white"
      >
        {replay.done ? "replay again" : "restart"}
      </button>
      <TaskState taskId={runId} state={replay.snapshot?.task.state ?? "–"} />
    </div>
  );
  if (replay.error !== null)
    return (
      <Shell right={right}>
        <p className="px-8 py-20 font-mono text-[13px] text-refused">{replay.error}</p>
      </Shell>
    );
  return (
    <Shell right={right}>
      <Board
        data={{
          taskId: runId,
          events: replay.events,
          snapshot: replay.snapshot,
          workers: replay.workers,
          chain: replay.chain,
        }}
      />
    </Shell>
  );
}

export function Live() {
  const [params] = useSearchParams();
  const replay = params.get("replay");
  return replay === null ? (
    <LiveView preferred={params.get("task")} />
  ) : (
    <ReplayView runId={replay} />
  );
}
