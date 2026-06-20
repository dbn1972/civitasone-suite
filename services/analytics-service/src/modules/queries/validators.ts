import { z } from "zod";
export const runQueryBody = z.object({
  queryName: z.string().min(1).max(200),
  dashboardId: z.string().uuid().optional(),
});
export type RunQueryBody = z.infer<typeof runQueryBody>;
export const queryRunViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  dashboardId: z.string().uuid().nullable(),
  queryName: z.string(),
  status: z.string(),
  resultRows: z.number().int(),
  version: z.number().int(),
});
