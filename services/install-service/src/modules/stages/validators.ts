import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createStageBody = z.object({
  name: z.string().min(1).max(128),
  stepNumber: z.number().int().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type CreateStageBody = z.infer<typeof createStageBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const stageViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  stepNumber: z.number().int(),
  description: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const stagesListSchema = paginatedSchema(stageViewSchema);
