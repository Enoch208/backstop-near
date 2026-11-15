import { z } from "zod";

export const faultSchema = z.enum(["none", "primary-after-checkpoint", "recovery-unavailable"]);
export type RepairFault = z.infer<typeof faultSchema>;
export const configSchema = z.object({
  enabled: z.boolean(),
  mode: z.literal("live-ai-testnet"),
  teamPaid: z.literal(true),
  maxAttempts: z.number().int().positive(),
  maxJobsPerDay: z.number().int().positive().optional(),
  budget: z.object({
    escrow: z.string(),
    premium: z.string(),
    bond: z.string(),
    compensationCap: z.string(),
    asset: z.literal("testnet NEAR"),
  }),
  limits: z.object({ maxBodyBytes: z.number().int().positive() }),
  faults: z.array(faultSchema),
});
export type RepairConfig = z.infer<typeof configSchema>;
export const jobSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  objective: z.string(),
  fault: faultSchema,
  status: z.enum(["running", "completed", "interrupted"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  logs: z.array(z.string()),
  report: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  artifactAvailable: z.boolean(),
});
export type RepairJob = z.infer<typeof jobSchema>;
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export const jobReplySchema = z.object({ job: jobSchema });
export const jobsReplySchema = z.object({ jobs: z.array(jobSchema) });
const endpoint = "/api/repair-jobs";

export async function repairRequest(
  path: string,
  token = "",
  body?: unknown,
  signal?: AbortSignal,
) {
  const headers = new Headers({ Accept: "application/json" });
  if (token !== "") headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${endpoint}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "The repair service is unavailable here. This host may only serve recorded evidence.",
    );
  }
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(result);
    throw new Error(
      error.success ? error.data.error.message : `Request failed (${String(response.status)}).`,
    );
  }
  return result;
}

export async function downloadArtifact(job: RepairJob, token: string) {
  const response = await fetch(`${endpoint}/${encodeURIComponent(job.id)}/artifact`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error("The verified artifact is not available. Refresh the run before retrying.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${job.id}.js`;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);
}
