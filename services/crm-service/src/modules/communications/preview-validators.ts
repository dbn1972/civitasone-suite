/**
 * Gap 1 — zod validators for campaign cost preview route.
 */
import { z } from "zod";
import { SEND_CHANNELS } from "./send-validators.js";

export const previewCampaignBody = z.object({
  contactIds: z.array(z.string().uuid()).optional(),
  segment: z.string().min(1).max(200).optional(),
  channel: z.enum(SEND_CHANNELS),
  templateId: z.string().uuid(),
});
export type PreviewCampaignBody = z.infer<typeof previewCampaignBody>;
