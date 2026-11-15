import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { digestOf, digestText } from "@backstop/shared";
import {
  jobSchema,
  maxJobsPerDay,
  recoveryInstruction,
  reportSchema,
  type RepairJob,
  type Submission,
} from "./schema.js";

export class JobConflict extends Error {}

export class RepairJobs {
  readonly jobs = new Map<string, RepairJob>();
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(directory)) {
      if (!/^repair-[a-f0-9-]{36}$/.test(entry)) continue;
      const path = join(directory, entry, "status.json");
      if (!existsSync(path)) throw new Error(`Incomplete job record: ${entry}`);
      const job = jobSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      if (job.id !== entry) throw new Error("Job record identity mismatch");
      this.jobs.set(job.id, job);
      if (job.status === "running") this.interrupt(job, recoveryInstruction);
    }
  }

  path(id: string, name: string): string {
    if (!this.jobs.has(id)) throw new Error("Unknown job");
    return join(this.directory, id, name);
  }

  save(job: RepairJob): void {
    job.updatedAt = new Date().toISOString();
    const path = this.path(job.id, "status.json");
    writeFileSync(`${path}.tmp`, JSON.stringify(job), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }

  create(submission: Submission): { job: RepairJob; created: boolean } {
    const requestHash = digestOf(submission);
    const existing = [...this.jobs.values()].find((job) => job.requestId === submission.requestId);
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash)
        throw new JobConflict("Request ID already belongs to a different task");
      return { job: existing, created: false };
    }
    if ([...this.jobs.values()].some((job) => job.status !== "completed")) {
      throw new JobConflict("Another task is running or awaiting settlement reconciliation");
    }
    const id = `repair-${submission.requestId}`;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    if (
      [...this.jobs.values()].filter((job) => job.createdAt.slice(0, 10) === today).length >=
      maxJobsPerDay
    ) {
      throw new JobConflict("The ten sponsored jobs for this UTC day have been used");
    }
    const job: RepairJob = {
      id,
      requestId: submission.requestId,
      requestHash,
      objective: submission.repairTask.objective,
      fault: submission.fault,
      status: "running",
      createdAt: now,
      updatedAt: now,
      logs: [],
      report: null,
      error: null,
      artifactAvailable: false,
    };
    mkdirSync(join(this.directory, id), { mode: 0o700 });
    this.jobs.set(id, job);
    writeFileSync(this.path(id, "task.json"), JSON.stringify(submission.repairTask), {
      flag: "wx",
      mode: 0o600,
    });
    this.save(job);
    return { job, created: true };
  }

  log(job: RepairJob, line: string): void {
    job.logs = [...job.logs, line.slice(0, 1000)].slice(-80);
    this.save(job);
  }

  interrupt(job: RepairJob, detail: string): void {
    job.status = "interrupted";
    job.error = `${detail} ${recoveryInstruction}`.slice(0, 1500);
    job.artifactAvailable = false;
    this.save(job);
  }

  finish(job: RepairJob, reportPath = this.path(job.id, "report.json")): void {
    const report = reportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
    if (report.taskId !== job.id || !report.verified)
      throw new Error("Final report does not confirm this task's settlement");
    job.report = report;
    if (report.state === "SETTLED") {
      const source = readFileSync(this.path(job.id, "artifact.js"), "utf8");
      if (digestText(source) !== report.artifactHash)
        throw new Error("Accepted artifact hash mismatch");
      job.artifactAvailable = true;
    }
    job.status = "completed";
    job.error = null;
    this.save(job);
  }

  artifact(job: RepairJob): string | null {
    if (
      job.status !== "completed" ||
      !job.artifactAvailable ||
      job.report?.state !== "SETTLED" ||
      !job.report.verified
    )
      return null;
    const source = readFileSync(this.path(job.id, "artifact.js"), "utf8");
    return digestText(source) === job.report.artifactHash ? source : null;
  }
}
