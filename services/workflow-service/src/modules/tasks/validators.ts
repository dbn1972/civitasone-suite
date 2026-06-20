import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const taskViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  instanceId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  version: z.number().int(),
});
