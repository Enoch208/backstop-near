import { describe, expect, it } from "vitest";
import { principals } from "@backstop/agents";
import { checkoutManifest } from "@backstop/fixture-checkout";
import { near, toYocto } from "@backstop/shared";
import { apiClient } from "@backstop/workers";
import { z } from "zod";
import { createRuntime, startApi, supervise } from "../src/index.js";

const fast = {
  leaseMs: 1_500,
  heartbeatGraceMs: 500,
  bidWindowMs: 1_000,
  challengeWindowMs: 1_000,
};
const eventSchema = z.object({ actor: z.string(), body: z.looseObject({ type: z.string() }) });

describe("a live swarm of worker processes", () => {
  it("G2 recovers from a real SIGKILL of the primary's process and settles exactly once", async () => {
    const runtime = createRuntime(Date.now, true);
    const api = await startApi(runtime, "127.0.0.1", 0, 100);
    const workers = supervise(runtime, api.url, () => undefined);
    runtime.workers = workers;
    const taskId = "checkout-sigkill";
    const customer = apiClient(api.url, principals.customer);
    const coordinator = apiClient(api.url, principals.coordinator);
    try {
      const manifest = checkoutManifest({
        taskId,
        createdAtMs: Date.now(),
        maxAttempts: 3,
        timing: fast,
      });
      await customer.post("/api/tasks", { manifest });
      const fund = (pool: string, amount: string) => ({
        pool,
        amountYocto: toYocto(near(amount)),
        liabilityYocto: null,
      });
      await customer.post(`/api/tasks/${taskId}/funding`, fund("escrow", "0.40"));
      await customer.post(`/api/tasks/${taskId}/funding`, fund("premium", "0.04"));
      await apiClient(api.url, principals.guarantor).post(
        `/api/tasks/${taskId}/funding`,
        fund("bond", "0.25"),
      );
      const seen: string[] = [];
      const settled = new Promise<void>((resolve) => {
        customer
          .follow(taskId, (raw) => {
            const event = eventSchema.parse(raw);
            seen.push(event.body.type);
            if (event.body.type === "checkpoint_recorded" && event.actor === "alpha") {
              void coordinator.post("/api/demo/faults", {
                action: "kill_worker",
                taskId,
                agentId: "alpha",
              });
            }
            if (event.body.type === "task_settled") resolve();
          })
          .catch(() => undefined);
      });
      await settled;
      const alpha = workers.processes().find((worker) => worker.agentId === "alpha");
      expect(alpha?.exit?.signal).toBe("SIGKILL");
      expect(seen).toEqual(
        expect.arrayContaining([
          "lease_expired",
          "recovery_awarded",
          "finding_recorded",
          "attempt_rejected",
          "task_accepted",
        ]),
      );
      const view = z
        .object({
          task: z.object({ state: z.string() }),
          statement: z.object({ confirmedByRecipient: z.record(z.string(), z.string()) }),
        })
        .parse((await customer.get(`/api/tasks/${taskId}`)).body);
      expect(view.task.state).toBe("SETTLED");
      expect(view.statement.confirmedByRecipient).toEqual({
        "gamma.fixture.testnet": toYocto(near("0.36")),
        "delta.fixture.testnet": toYocto(near("0.18")),
        "customer.fixture.testnet": toYocto(near("0.04")),
        "guarantor.fixture.testnet": toYocto(near("0.11")),
      });
      const logs = z
        .object({ lines: z.array(z.object({ agentId: z.string(), line: z.string() })) })
        .parse((await customer.get(`/api/tasks/${taskId}/logs`)).body);
      const said = (agentId: string, start: string) =>
        logs.lines.some((entry) => entry.agentId === agentId && entry.line.startsWith(start));
      expect(said("alpha", "claimed attempt")).toBe(true);
      expect(logs.lines.some((entry) => entry.line.startsWith("pricing: "))).toBe(true);
      expect(logs.lines.every((entry) => !entry.line.startsWith("["))).toBe(true);
      const again = await coordinator.post("/api/demo/faults", {
        action: "repeat_settlement",
        taskId,
      });
      expect(again.status).toBe(409);
    } finally {
      await api.close();
    }
  }, 60_000);
});
