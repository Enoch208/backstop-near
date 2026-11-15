import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestText, repairTaskSchema } from "@backstop/shared";
import { afterEach, describe, expect, it } from "vitest";
import { RepairJobs } from "../../../scripts/repair-service/store.js";
import { repairServer } from "../../../scripts/repair-service/server.js";
import { submissionSchema, type RepairJob } from "../../../scripts/repair-service/schema.js";

const token = "test-access-code-012345678901234567890";
const origin = "http://localhost:5210";
const task = repairTaskSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../fixtures/repair/normalize-intervals.json", import.meta.url),
      "utf8",
    ),
  ),
);
const cleanups: (() => Promise<void>)[] = [];

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "backstop-repair-service-"));
  const store = new RepairJobs(directory);
  const launched: RepairJob[] = [];
  const server = repairServer({
    token,
    enabled: true,
    origins: [origin],
    store,
    launch: (job) => {
      launched.push(job);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test port");
  const url = `http://127.0.0.1:${String(address.port)}/api/repair-jobs`;
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      }),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", origin };
  const submission = submissionSchema.parse({
    requestId: randomUUID(),
    repairTask: task,
    fault: "primary-after-checkpoint",
  });
  const post = (value: unknown) =>
    fetch(url, { method: "POST", headers, body: JSON.stringify(value) });
  return { store, launched, url, headers, submission, post, directory };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("authenticated live repair pilot", () => {
  it("publishes safe mode information but protects jobs and rejects other browser origins", async () => {
    const { url, post, submission, headers, launched } = await setup();
    const config = await fetch(`${url}/config`);
    expect(await config.json()).toMatchObject({
      enabled: true,
      teamPaid: true,
      mode: "live-ai-testnet",
    });
    expect((await fetch(url)).status).toBe(401);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { ...headers, authorization: "Bearer wrong" },
          body: JSON.stringify(submission),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { ...headers, origin: "https://other.example" },
          body: JSON.stringify(submission),
        })
      ).status,
    ).toBe(403);
    expect(launched).toHaveLength(0);
    expect((await post(submission)).status).toBe(202);
  });

  it("refuses invalid bundles, oversized bodies and partial-milestone normal repairs", async () => {
    const { post, submission, launched, url, headers } = await setup();
    expect(
      (
        await post({
          ...submission,
          repairTask: {
            ...task,
            suite: {
              ...task.suite,
              cases: task.suite.cases.filter((entry) => entry.visibility === "public"),
            },
          },
        })
      ).status,
    ).toBe(400);
    expect((await post({ ...submission, fault: "none" })).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers, body: "a".repeat(210_001) })).status).toBe(
      413,
    );
    expect(launched).toHaveLength(0);
  });

  it("rejects an inconsistent oracle before launching or consuming sponsorship", async () => {
    const { post, submission, launched, store } = await setup();
    const response = await post({
      ...submission,
      repairTask: {
        ...task,
        suite: { ...task.suite, oracleSource: "function mergeIntervals() { return []; }" },
      },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_ORACLE" } });
    expect(launched).toHaveLength(0);
    expect(store.jobs.size).toBe(0);
  });

  it("deduplicates identical submissions and rejects request-ID changes and overlapping jobs", async () => {
    const { post, submission, launched } = await setup();
    const replies = await Promise.all([post(submission), post(submission)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 202]);
    expect(launched).toHaveLength(1);
    expect((await post({ ...submission, fault: "recovery-unavailable" })).status).toBe(409);
    expect((await post({ ...submission, requestId: randomUUID() })).status).toBe(409);
  });

  it("serves only the verified settled artifact and checks its hash on every download", async () => {
    const { post, submission, store, launched, url, headers } = await setup();
    await post(submission);
    const job = launched[0];
    if (job === undefined) throw new Error("Job not launched");
    const artifactUrl = `${url}/${job.id}/artifact`;
    expect((await fetch(artifactUrl, { headers })).status).toBe(409);
    const source = "function repair(input) { return input; }";
    writeFileSync(store.path(job.id, "artifact.js"), source);
    writeFileSync(
      store.path(job.id, "report.json"),
      JSON.stringify({
        taskId: job.id,
        network: "testnet",
        mode: "live-ai",
        state: "SETTLED",
        verified: true,
        artifactHash: digestText(source),
      }),
    );
    store.finish(job);
    expect(await (await fetch(artifactUrl, { headers })).text()).toBe(source);
    writeFileSync(store.path(job.id, "artifact.js"), `${source}\n`);
    expect((await fetch(artifactUrl, { headers })).status).toBe(409);
  });

  it("never delivers artifacts for refunds or unverified reports", async () => {
    const { store, submission } = await setup();
    const { job } = store.create(submission);
    const report = {
      taskId: job.id,
      network: "testnet",
      mode: "live-ai",
      state: "FAILURE_SETTLED",
      verified: false,
    };
    writeFileSync(store.path(job.id, "report.json"), JSON.stringify(report));
    expect(() => {
      store.finish(job);
    }).toThrow("does not confirm");
    writeFileSync(store.path(job.id, "report.json"), JSON.stringify({ ...report, verified: true }));
    store.finish(job);
    expect(job.status).toBe("completed");
    expect(store.artifact(job)).toBeNull();
  });

  it("preserves idempotency and blocks new spending after an interrupted gateway restart", async () => {
    const { store, submission, directory } = await setup();
    store.create(submission);
    const restarted = new RepairJobs(directory);
    const repeated = restarted.create(submission);
    expect(repeated.created).toBe(false);
    expect(repeated.job.status).toBe("interrupted");
    expect(repeated.job.error).toContain("Settlement is not confirmed");
    expect(() => restarted.create({ ...submission, requestId: randomUUID() })).toThrow(
      "reconciliation",
    );
  });

  it("keeps the ten-job daily sponsorship cap across restarts and does not count replays twice", async () => {
    const { store, submission, directory } = await setup();
    for (let count = 0; count < 10; count += 1) {
      const { job } = store.create({ ...submission, requestId: randomUUID() });
      job.status = "completed";
      store.save(job);
    }
    const restarted = new RepairJobs(directory);
    expect(() => restarted.create(submission)).toThrow("ten sponsored jobs");
    const oldest = [...restarted.jobs.values()][0];
    if (oldest === undefined) throw new Error("No job recorded");
    expect(restarted.create({ ...submission, requestId: oldest.requestId }).created).toBe(false);
    oldest.createdAt = "2020-01-01T00:00:00.000Z";
    restarted.save(oldest);
    expect(restarted.create(submission).created).toBe(true);
  });
});
