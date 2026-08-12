/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createJobBody = z.object({
  name: z.string().min(1).max(200),
  reportType: z.string().min(1).max(64).optional(),
});
export type CreateJobBody = z.infer<typeof createJobBody>;

export const idParam = z.object({ id: z.string().uuid() });

/** Query params for the download endpoint (watermark support for ad-hoc exports) */
export const downloadQuerySchema = z.object({
  watermarkText: z.string().max(200).optional(),
});

export const jobViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  reportType: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const jobsListSchema = paginatedSchema(jobViewSchema);

export const shareJobBody = z.object({
  recipients: z.array(z.string().email()).min(1).max(50),
  message: z.string().max(500).optional(),
});
export type ShareJobBody = z.infer<typeof shareJobBody>;
