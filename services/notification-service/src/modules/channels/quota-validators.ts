import { z } from "zod";

const CHANNELS = ["email", "sms", "whatsapp", "push"] as const;
const QUOTA_STATUSES = ["active", "exhausted", "unlimited"] as const;

export const upsertQuotaBody = z.object({
  channel:      z.enum(CHANNELS),
  monthlyLimit: z.number().int().positive(),
  periodStart:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status:       z.enum(QUOTA_STATUSES).optional(),
});

export type UpsertQuotaBody = z.infer<typeof upsertQuotaBody>;
