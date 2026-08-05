import { z } from "zod";

/**
 * Money in minor units (PAISE). Accepts an integer or a numeric string from the
 * client and normalises to a canonical decimal STRING via BigInt — never a
 * float. `Math.round(n * 100)` and Number arithmetic are deliberately avoided:
 * paise are integers end-to-end. The string can be arbitrarily large (bigint).
 */
export const minorUnits = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v).toString());

export const createCampaignBody = z.object({
  templateId:        z.string().uuid(),
  name:              z.string().min(1).max(128),
  recipients:        z.array(z.string().min(1)).min(1),
  scheduledAt:       z.string().datetime().optional(),
  // MK-001 marketing fields
  objective:         z.string().max(500).optional(),
  budgetMinor:       minorUnits.optional(),
  currency:          z.string().length(3).default("INR"),
  audienceSegmentId: z.string().uuid().optional(),
});
export type CreateCampaignBody = z.infer<typeof createCampaignBody>;

export const campaignIdParam = z.object({ id: z.string().uuid() });

export const listCampaignsQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuery>;

/**
 * MK-004: record/attribute a campaign response. This is the seam CRM
 * conversions call. `revenueMinor` is attributed revenue in PAISE (bigint).
 */
export const recordResponseBody = z.object({
  subjectType:  z.enum(["lead", "contact", "account"]),
  subjectId:    z.string().uuid(),
  converted:    z.boolean().optional(),
  revenueMinor: minorUnits.optional(),
});
export type RecordResponseBody = z.infer<typeof recordResponseBody>;
