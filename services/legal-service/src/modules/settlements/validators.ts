import { z } from "zod";

export const createSettlementBody = z.object({
  caseId:       z.string().uuid().optional(),
  settlementNo: z.string().min(1).max(64),
  amountMinor:  z.number().int().nonnegative(),
  currency:     z.string().length(3).default("INR"),
  lokAdalat:    z.object({
    lokAdalatDate: z.string(),
    venue:         z.string().min(1).max(256),
    outcome:       z.string().max(1000).optional(),
  }).optional(),
});
export type CreateSettlementBody = z.infer<typeof createSettlementBody>;
