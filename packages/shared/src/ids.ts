import { z } from "zod";

export const taskIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export type TaskId = z.infer<typeof taskIdSchema>;

export const agentIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/);
export type AgentId = z.infer<typeof agentIdSchema>;

export const nearAccountSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/);
export type NearAccount = z.infer<typeof nearAccountSchema>;

export const hexSchema = z.string().regex(/^[0-9a-f]+$/);
