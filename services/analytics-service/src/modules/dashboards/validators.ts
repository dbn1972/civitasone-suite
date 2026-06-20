import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";
export const dashboardViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});
export const dashboardsListSchema = paginatedSchema(dashboardViewSchema);
