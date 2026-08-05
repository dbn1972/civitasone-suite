/**
 * Gap 3 — zod validators for nurture rules.
 */
import { z } from "zod";

export const TRIGGER_TYPES = ["score_below", "inactive_days", "stage_change"] as const;
export const NURTURE_CHANNELS = ["email", "sms", "whatsapp"] as const;

export const createNurtureRuleBody = z.object({
  triggerType: z.enum(TRIGGER_TYPES),
  threshold: z.number().int().min(0),
  templateId: z.string().uuid(),
  channel: z.enum(NURTURE_CHANNELS),
  enabled: z.boolean().optional(),
});
export type CreateNurtureRuleBody = z.infer<typeof createNurtureRuleBody>;
