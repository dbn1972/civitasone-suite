/**
 * exports/validators.ts — Zod schemas for export route validation.
 */
import { z } from "zod";

export const createExportBodySchema = z
  .object({
    queryRunId: z.string().uuid(),
    format: z.enum(["csv", "json", "pdf", "xlsx"]),
  })
  .strict();

export type CreateExportBodyInput = z.infer<typeof createExportBodySchema>;

export const exportIdParam = z.object({ id: z.string().uuid() });
