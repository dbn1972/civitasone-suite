import { z } from "zod";

export const createDepScheduleBody = z.object({
  method:          z.enum(["SLM", "WDV"]),
  startDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateDepScheduleBody = z.infer<typeof createDepScheduleBody>;

export const runDepBody = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
});
export type RunDepBody = z.infer<typeof runDepBody>;

export const assetIdParam = z.object({ id: z.string().uuid() });
