import { z } from "zod";

const FY = z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY");

export const monitoringQuery = z.object({
  fy:    FY,
  asOf:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type MonitoringQuery = z.infer<typeof monitoringQuery>;
