import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const dealStage = z.enum(["Lead", "Proposal", "Negotiation", "Won", "Lost"]);

export const createDealBody = z.object({
  name: z.string().min(1).max(200),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  stage: dealStage.default("Lead"),
  valueMinor: z.number().int().nonnegative().default(0),
  currency: z.string().length(3).default("INR"),
  contactId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  probability: z.number().int().min(0).max(100).default(0),
});
export type CreateDealBody = z.infer<typeof createDealBody>;

export const updateDealStageBody = z.object({
  stage: dealStage,
  stageId: z.string().uuid().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  version: z.number().int().min(1),
});
export type UpdateDealStageBody = z.infer<typeof updateDealStageBody>;

// P1-1 deal edit: value/owner/closeDate/contactId. At least one field required.
export const updateDealBody = z.object({
  valueMinor: z.number().int().nonnegative().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateDealBody = z.infer<typeof updateDealBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const dealViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  pipelineId: z.string().uuid().nullable().optional(),
  stageId: z.string().uuid().nullable().optional(),
  name: z.string(),
  stage: dealStage,
  valueMinor: z.string(),
  currency: z.string(),
  valueDisplay: z.string(),
  contactId: z.string().uuid().nullable().optional(),
  contactName: z.string().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  closeDate: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  probability: z.number().int().optional(),
  status: z.string(),
  version: z.number().int(),
});

export const dealsListSchema = paginatedSchema(dealViewSchema);
