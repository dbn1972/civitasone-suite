import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const taskViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  instanceId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  roleRef: z.string().nullable().optional(),
  nodeKey: z.string().nullable().optional(),
  refType: z.string().nullable().optional(),
  refId: z.string().uuid().nullable().optional(),
  decision: z.string().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  version: z.number().int(),
});

export const completeTaskBody = z.object({
  decision: z.enum(["approve", "reject", "return"]).default("approve"),
});

// P1-1 — assign a task to a specific user.
export const assignTaskBody = z.object({
  assigneeId: z.string().uuid(),
});

// P1-3 — bulk-complete a set of tasks; each runs the per-task complete command.
export const bulkCompleteBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(200),
  decision: z.enum(["approve", "reject", "return"]).default("approve"),
});
