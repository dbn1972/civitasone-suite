/**
 * Gap 2 — zod validators for campaign approval workflow routes.
 */
import { z } from "zod";

export const campaignIdParam = z.object({ id: z.string().uuid() });
export type CampaignIdParam = z.infer<typeof campaignIdParam>;

export const rejectCampaignBody = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type RejectCampaignBody = z.infer<typeof rejectCampaignBody>;
