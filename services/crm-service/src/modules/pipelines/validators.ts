import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const pipelineStageSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  probability: z.number().int().min(0).max(100),
  ordinal: z.number().int().min(0),
  // OP-003: deal field names that must be populated to move INTO this stage.
  mandatoryFields: z.array(z.string().min(1).max(64)).max(32).optional(),
  gate: z.boolean().optional(),
});

const scope = {
  product: z.string().min(1).max(120).nullable().optional(),
  region: z.string().min(1).max(120).nullable().optional(),
  businessUnit: z.string().min(1).max(120).nullable().optional(),
};

export const createPipelineBody = z.object({
  name: z.string().min(1).max(200),
  stages: z.array(pipelineStageSchema).min(3).max(10),
  ...scope,
});
export type CreatePipelineBody = z.infer<typeof createPipelineBody>;

export const updatePipelineBody = z.object({
  name: z.string().min(1).max(200).optional(),
  stages: z.array(pipelineStageSchema).min(3).max(10).optional(),
  ...scope,
  version: z.number().int().min(1),
}).refine(
  (b) => b.name !== undefined || b.stages !== undefined || b.product !== undefined || b.region !== undefined || b.businessUnit !== undefined,
  { message: "at least one mutable field is required" },
);
export type UpdatePipelineBody = z.infer<typeof updatePipelineBody>;

export const idParam = z.object({ id: z.string().uuid() });

/** OP-002: scope filter on the list endpoint. */
export const pipelineListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  product: z.string().min(1).max(120).optional(),
  region: z.string().min(1).max(120).optional(),
  businessUnit: z.string().min(1).max(120).optional(),
});

export const pipelineViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  stages: z.array(pipelineStageSchema),
  product: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  businessUnit: z.string().nullable().optional(),
  status: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pipelinesListSchema = paginatedSchema(pipelineViewSchema);
