import { z } from "zod";

export const recordUsageBody = z.object({
  tenantId: z.string().uuid(),
  metricKey: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
});

export const tenantParam = z.object({ id: z.string().uuid() });
export const usageQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
