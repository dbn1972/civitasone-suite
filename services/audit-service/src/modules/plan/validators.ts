import { z } from "zod";

export const createPlanBody = z.object({
  planNo:     z.string().min(1).max(64),
  title:      z.string().min(1).max(256),
  area:       z.string().min(1).max(128),
  periodFrom: z.string(),
  periodTo:   z.string(),
  riskLevel:  z.enum(["low", "medium", "high"]).default("medium"),
});
export type CreatePlanBody = z.infer<typeof createPlanBody>;

export const createPlanItemBody = z.object({
  deptRef:       z.string().min(1).max(128),
  unitRef:       z.string().max(128).optional(),
  scheduledFrom: z.string(),
  scheduledTo:   z.string(),
});
export type CreatePlanItemBody = z.infer<typeof createPlanItemBody>;

export const idParam = z.object({ id: z.string().uuid() });
