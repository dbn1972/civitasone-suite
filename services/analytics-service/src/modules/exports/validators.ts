/**
 * exports/validators.ts — Zod schemas for export route validation.
 */
import { z } from "zod";

export const createExportBodySchema = z
  .object({
    queryRunId: z.string().uuid(),
    format: z.enum(["csv", "json", "pdf", "xlsx"]),
    /** Optional watermark text to overlay on the export */
    watermark: z.string().max(200).optional(),
    /** Column keys containing PII to mask for non-privileged roles */
    piiColumns: z.array(z.string().min(1).max(128)).max(50).optional(),
  })
  .strict();

export type CreateExportBodyInput = z.infer<typeof createExportBodySchema>;

export const exportIdParam = z.object({ id: z.string().uuid() });
