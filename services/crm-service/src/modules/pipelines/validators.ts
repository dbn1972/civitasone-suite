import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const pipelineStageSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  probability: z.number().int().min(0).max(100),
  ordinal: z.number().int().min(0),
});

export const createPipelineBody = z.object({
  name: z.string().min(1).max(200),
  stages: z.array(pipelineStageSchema).min(3).max(10),
});
export type CreatePipelineBody = z.infer<typeof createPipelineBody>;

export const updatePipelineBody = z.object({
  name: z.string().min(1).max(200).optional(),
  stages: z.array(pipelineStageSchema).min(3).max(10).optional(),
  version: z.number().int().min(1),
}).refine((b) => b.name !== undefined || b.stages !== undefined, {
  message: "at least one of name or stages is required",
});
export type UpdatePipelineBody = z.infer<typeof updatePipelineBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const pipelineViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  stages: z.array(pipelineStageSchema),
  status: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pipelinesListSchema = paginatedSchema(pipelineViewSchema);
