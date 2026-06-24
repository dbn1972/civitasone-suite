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
  version: z.number().int(),
});

export const completeTaskBody = z.object({
  decision: z.enum(["approve", "reject", "return"]).default("approve"),
});
