import { useEffect, useRef, useState } from "react";
import type { RepairTask } from "@backstop/shared";
import {
  configSchema,
  jobReplySchema,
  jobsReplySchema,
  repairRequest,
  type RepairConfig,
  type RepairFault,
  type RepairJob,
} from "./client.js";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "The repair request failed.";

export function useRepair() {
  const [config, setConfig] = useState<RepairConfig | null>(null);
  const [availability, setAvailability] = useState("Checking the repair service…");
  const [token, setToken] = useState("");
  const [job, setJob] = useState<RepairJob | null>(null);
  const [jobs, setJobs] = useState<RepairJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ payload: string; requestId: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void repairRequest("/config", "", undefined, controller.signal)
      .then((reply) => {
        const next = configSchema.parse(reply);
        setConfig(next);
        setAvailability(
          next.enabled
            ? "Live repair service available"
            : "New repair jobs are disabled on this host.",
        );
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setAvailability(message(failure));
      });
    return () => {
      controller.abort();
    };
  }, []);

  const jobId = job?.id;
  const running = job?.status === "running";
  useEffect(() => {
    if (jobId === undefined || !running || token === "") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const reply = jobReplySchema.parse(
          await repairRequest(`/${encodeURIComponent(jobId)}`, token, undefined, controller.signal),
        );
        if (!controller.signal.aborted) {
          setJob(reply.job);
          setError(null);
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(`Status refresh failed: ${message(failure)} The job may still be running.`);
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void poll();
          }, 2_000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, running, token]);

  async function submit(repairTask: RepairTask, fault: RepairFault) {
    if (busy || running) return;
    setBusy(true);
    setError(null);
    const payload = JSON.stringify({ repairTask, fault });
    if (pending.current?.payload !== payload)
      pending.current = { payload, requestId: crypto.randomUUID() };
    try {
      const reply = jobReplySchema.parse(
        await repairRequest("", token, {
          requestId: pending.current.requestId,
          repairTask,
          fault,
        }),
      );
      setJob(reply.job);
      pending.current = null;
    } catch (failure) {
      setError(
        `${message(failure)} If the response was lost, retry the same task to recover its existing job.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setJobs(jobsReplySchema.parse(await repairRequest("", token)).jobs);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return {
    config,
    availability,
    token,
    setToken,
    job,
    setJob,
    jobs,
    busy,
    running,
    error,
    setError,
    submit,
    refresh,
  };
}
