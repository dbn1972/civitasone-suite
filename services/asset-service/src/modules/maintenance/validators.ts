import { z } from "zod";

export const maintenancePlanBody = z.object({
  frequency:   z.string().min(1).max(16).default("monthly"),
  nextDue:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().optional(),
});
export type MaintenancePlanBody = z.infer<typeof maintenancePlanBody>;

export const workOrderBody = z.object({
  assetId:       z.string().uuid(),
  planId:        z.string().uuid().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:         z.string().optional(),
});
export type WorkOrderBody = z.infer<typeof workOrderBody>;

export const completeWorkOrderBody = z.object({
  completedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costMinor:     z.number().int().nonnegative().default(0),
  currency:      z.string().length(3).default("INR"),
  notes:         z.string().optional(),
});
export type CompleteWorkOrderBody = z.infer<typeof completeWorkOrderBody>;

export const idParam    = z.object({ id: z.string().uuid() });
export const assetParam = z.object({ id: z.string().uuid() });
