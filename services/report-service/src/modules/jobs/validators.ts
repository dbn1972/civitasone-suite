/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createJobBody = z.object({
  name: z.string().min(1).max(200),
  reportType: z.string().min(1).max(64).optional(),
});
export type CreateJobBody = z.infer<typeof createJobBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const jobViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  reportType: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const jobsListSchema = paginatedSchema(jobViewSchema);
