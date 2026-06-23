import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const dealStage = z.enum(["Lead", "Proposal", "Negotiation", "Won", "Lost"]);

export const createDealBody = z.object({
  name: z.string().min(1).max(200),
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
});
export type UpdateDealStageBody = z.infer<typeof updateDealStageBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const dealViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  stage: dealStage,
  valueMinor: z.string(),
  currency: z.string(),
  valueDisplay: z.string(),
  contactId: z.string().uuid().nullable().optional(),
  contactName: z.string().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  closeDate: z.string().nullable().optional(),
  probability: z.number().int().optional(),
  status: z.string(),
  version: z.number().int(),
});

export const dealsListSchema = paginatedSchema(dealViewSchema);
