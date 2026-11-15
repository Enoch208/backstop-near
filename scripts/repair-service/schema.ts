import { digestSchema, repairTaskSchema } from "@backstop/shared";
import { z } from "zod";

export const faults = ["none", "primary-after-checkpoint", "recovery-unavailable"] as const;
export const maxBodyBytes = 210_000;
export const maxJobsPerDay = 10;
export const submissionSchema = z
  .strictObject({
    requestId: z.uuid().transform((value) => value.toLowerCase()),
    repairTask: repairTaskSchema,
    fault: z.enum(faults),
  })
  .superRefine((submission, ctx) => {
    if (submission.fault === "none" && submission.repairTask.primaryMilestone !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "A normal repair cannot contain a partial primary milestone",
      });
    }
  });
export type Submission = z.infer<typeof submissionSchema>;

export const reportSchema = z
  .object({
    taskId: z.string(),
    state: z.enum(["SETTLED", "FAILURE_SETTLED"]),
    network: z.literal("testnet"),
    mode: z.literal("live-ai"),
    verified: z.boolean(),
    artifactHash: digestSchema.optional(),
  })
  .loose();
export type Report = z.infer<typeof reportSchema>;

export const jobSchema = z.strictObject({
  id: z.string().regex(/^repair-[a-f0-9-]{36}$/),
  requestId: z.uuid(),
  requestHash: digestSchema,
  objective: z.string(),
  fault: z.enum(faults),
  status: z.enum(["running", "completed", "interrupted"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  logs: z.array(z.string()).max(80),
  report: reportSchema.nullable(),
  error: z.string().nullable(),
  artifactAvailable: z.boolean(),
});
export type RepairJob = z.infer<typeof jobSchema>;

export const recoveryInstruction =
  "Execution was interrupted. Settlement is not confirmed. An operator must reconcile this task with the testnet vault and complete or trigger its overdue refund before accepting another job.";

export function serviceConfig(enabled: boolean) {
  return {
    enabled,
    mode: "live-ai-testnet",
    teamPaid: true,
    maxAttempts: 3,
    maxJobsPerDay,
    budget: {
      escrow: "0.40",
      premium: "0.04",
      bond: "0.25",
      compensationCap: "0.10",
      asset: "testnet NEAR",
    },
    limits: { maxBodyBytes },
    faults,
  };
}
