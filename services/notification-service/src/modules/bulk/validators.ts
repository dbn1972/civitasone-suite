import { z } from "zod";

export const createCampaignBody = z.object({
  templateId:   z.string().uuid(),
  name:         z.string().min(1).max(128),
  recipients:   z.array(z.string().min(1)).min(1),
  scheduledAt:  z.string().datetime().optional(),
});
export type CreateCampaignBody = z.infer<typeof createCampaignBody>;

export const campaignIdParam = z.object({ id: z.string().uuid() });
