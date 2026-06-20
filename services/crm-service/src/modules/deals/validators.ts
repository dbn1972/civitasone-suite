import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

const dealStage = z.enum(["Lead", "Proposal", "Negotiation", "Won", "Lost"]);

export const createDealBody = z.object({
  name: z.string().min(1).max(200),
  stage: dealStage.default("Lead"),
  valueMinor: z.number().int().nonnegative().default(0),
  currency: z.string().length(3).default("INR"),
});
export type CreateDealBody = z.infer<typeof createDealBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const dealViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  stage: dealStage,
  valueMinor: z.string(),
  currency: z.string(),
  valueDisplay: z.string(),
  status: z.string(),
  version: z.number().int(),
});

export const dealsListSchema = paginatedSchema(dealViewSchema);
