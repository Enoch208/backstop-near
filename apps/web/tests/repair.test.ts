import { afterEach, describe, expect, it, vi } from "vitest";
import { repairRequest } from "../src/repair/client.js";
import { exampleTask } from "../src/repair/example.js";
import { nearAmount, repairReportSchema } from "../src/repair/report.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repair submission boundaries", () => {
  it("offers a full repair objective with distinct public and held-out cases", () => {
    expect(exampleTask.primaryMilestone).toBeUndefined();
    const publicInputs = exampleTask.suite.cases
      .filter((entry) => entry.visibility === "public")
      .map((entry) => JSON.stringify(entry.input));
    const heldOut = exampleTask.suite.cases.filter((entry) => entry.visibility === "held_out");
    expect(publicInputs.length).toBeGreaterThan(0);
    expect(heldOut.length).toBeGreaterThan(0);
    for (const entry of heldOut) expect(publicInputs).not.toContain(JSON.stringify(entry.input));
  });

  it("treats a static host's HTML fallback as an unavailable service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Backstop</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(repairRequest("/config")).rejects.toThrow("repair service is unavailable");
  });

  it("preserves the backend's refusal instead of treating an HTTP error as a job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "JOB_CONFLICT",
              message: "A previous task still needs reconciliation",
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(repairRequest("", "pilot-code", { requestId: "test" })).rejects.toThrow(
      "still needs reconciliation",
    );
  });

  it("preserves a single yocto and large exact balances without floating point", () => {
    expect(nearAmount("1")).toBe("0.000000000000000000000001 NEAR");
    expect(nearAmount("9007199254740993000000000000000000000001")).toBe(
      "9007199254740993.000000000000000000000001 NEAR",
    );
  });

  it("refuses an incomplete report instead of displaying a claimed settlement", () => {
    expect(repairReportSchema.safeParse({ state: "SETTLED", verified: true }).success).toBe(false);
  });
});
