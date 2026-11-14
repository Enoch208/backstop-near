import { useState } from "react";
import { Link, Navigate } from "react-router";
import { buttonClass, Chip, PageHeader, Panel, Segmented } from "../app/ui.js";
import { whenUtc } from "../data/record.js";
import {
  chainSchema,
  controlSchema,
  logsSchema,
  postControl,
  snapshotSchema,
  useEvents,
  useLatestTask,
  usePolled,
  workersSchema,
} from "./api.js";
import { Board } from "./Board.js";
import { useRecordings, useReplay } from "./replay.js";

function Waiting({ recording }: { readonly recording: string | null }) {
  return (
    <>
      <PageHeader
        eyebrow="Mission Control"
        title="No live run on this machine."
        subtitle="Replay a run recorded on NEAR testnet, or start the swarm locally and this page follows it as it happens."
        actions={
          recording !== null && (
            <Link to={`/app/runs/${recording}`} className={buttonClass.primary}>
              Replay the latest run
            </Link>
          )
        }
      />
      <Panel title="Run it yourself" meta="two terminals">
        <pre className="overflow-x-auto rounded-xl bg-page px-5 py-4 font-mono text-[13px] leading-[1.7]">
          pnpm web{"\n"}pnpm demo --hold
        </pre>
        <p className="mt-3 text-[13px] leading-[1.5] text-ink/60">
          Add <span className="font-mono text-[12px]">--chain testnet</span> to settle on NEAR, and
          set <span className="font-mono text-[12px]">BACKSTOP_AI_API_KEY</span> for live,
          TEE-signed repairs.
        </p>
      </Panel>
    </>
  );
}

export function LatestReplay() {
  const recordings = useRecordings();
  if (recordings === null) return null;
  const latest = recordings.at(-1);
  return <Navigate to={latest === undefined ? "/app/live" : `/app/runs/${latest}`} replace />;
}

export function LivePage() {
  const latest = useLatestTask(null);
  const recordings = useRecordings();
  const taskId = latest.taskId;
  const base = taskId === null ? null : `/api/tasks/${encodeURIComponent(taskId)}`;
  const snapshot = usePolled(base, snapshotSchema, 800);
  const workers = usePolled(taskId === null ? null : "/api/workers", workersSchema, 1000);
  const chain = usePolled(base === null ? null : `${base}/chain`, chainSchema, 1500);
  const logs = usePolled(base === null ? null : `${base}/logs`, logsSchema, 1000);
  const events = useEvents(taskId);
  const hosted = usePolled("/api/demo/control", controlSchema, 700).value;
  if (taskId === null)
    return hosted === null ? (
      <Waiting recording={recordings?.at(-1) ?? null} />
    ) : (
      <PageHeader
        eyebrow="Mission Control · scripted fixture"
        title="Starting a fresh run."
        subtitle="Team-controlled agent processes are starting a scripted fixture on this server. The vault is simulated; this creates no NEAR transactions."
      />
    );
  return (
    <>
      <PageHeader
        eyebrow={
          hosted === null
            ? "Mission Control · live processes"
            : "Mission Control · scripted fixture"
        }
        title={`Following ${taskId}`}
        subtitle={
          hosted === null
            ? "Read from the local API as it happens: the event log over SSE, the agents' own output, the verdict, the ledger and every NEAR transaction."
            : "Interactive fixture: team-controlled processes, scripted repairs and simulated transfers. Kill the worker to trigger recovery. Real testnet outcomes are linked from Overview."
        }
        actions={
          <>
            <Chip tone={hosted === null ? "pass" : "warn"}>
              {hosted === null ? "Live process feed" : "Scripted fixture · simulated vault"}
            </Chip>
            {hosted?.canKill === true && (
              <>
                <Chip tone="warn">
                  Auto in {String(Math.ceil((hosted.autoKillInMs ?? 0) / 1_000))} s
                </Chip>
                <button
                  type="button"
                  onClick={() => {
                    void postControl("kill");
                  }}
                  className={buttonClass.primary}
                >
                  Kill alpha
                </button>
              </>
            )}
            {hosted?.canStart === true && (
              <button
                type="button"
                onClick={() => {
                  void postControl("start");
                }}
                className={buttonClass.secondary}
              >
                Start a new run
              </button>
            )}
          </>
        }
      />
      <Board
        data={{
          taskId,
          events,
          snapshot: snapshot.value,
          workers: (workers.value?.workers ?? []).filter((worker) => worker.taskId === taskId),
          chain: chain.value,
          lines: logs.value?.lines ?? [],
        }}
      />
    </>
  );
}

const speeds = [
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 4, label: "4×" },
] as const;

export function ReplayView({ runId }: { readonly runId: string }) {
  const [speed, setSpeed] = useState<1 | 2 | 4>(2);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const replay = useReplay(runId, speed, startedAt);
  const run = replay.run;
  if (replay.error !== null)
    return <PageHeader eyebrow="Mission Control · replay" title={runId} subtitle={replay.error} />;
  return (
    <>
      <PageHeader
        eyebrow="Mission Control · replay"
        title={`Replay of ${runId}`}
        subtitle={
          run === null
            ? "Loading the recorded frames."
            : `Recorded on NEAR ${run.network} on ${whenUtc(run.recordedAt)}${run.model === null ? " with scripted repairs" : ` with live AI (${run.model})`}. Team-controlled workers; captured API frames and real transaction links. A replay does not launch new work.`
        }
        actions={
          <>
            <Chip tone="info">Replay</Chip>
            <Segmented
              label="Playback speed"
              options={speeds}
              value={speed}
              onChange={(next) => {
                setStartedAt(Date.now());
                setSpeed(next);
              }}
            />
            <button
              type="button"
              onClick={() => {
                setStartedAt(Date.now());
              }}
              className={buttonClass.secondary}
            >
              {replay.done ? "Play again" : "Restart"}
            </button>
          </>
        }
      />
      <Board
        data={{
          taskId: runId,
          events: replay.events,
          snapshot: replay.snapshot,
          workers: replay.workers,
          chain: replay.chain,
          lines: replay.lines,
        }}
      />
    </>
  );
}
