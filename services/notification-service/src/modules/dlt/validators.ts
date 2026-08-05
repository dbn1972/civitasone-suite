import { z } from "zod";

const DLT_CONTENT_TYPES = ["promotional", "transactional", "service_implicit", "service_explicit"] as const;
const DLT_CHANNELS = ["sms", "whatsapp"] as const;
const DLT_STATUSES = ["active", "expired", "revoked"] as const;

export const createDltTemplateBody = z.object({
  entityId:     z.string().min(1).max(32),
  templateId:   z.string().min(1).max(32),
  headerId:     z.string().min(1).max(16),
  contentType:  z.enum(DLT_CONTENT_TYPES),
  templateBody: z.string().min(1),
  channel:      z.enum(DLT_CHANNELS),
  status:       z.enum(DLT_STATUSES).optional(),
  registeredAt: z.string().datetime().optional(),
  expiresAt:    z.string().datetime().optional(),
});

export const updateDltTemplateBody = z.object({
  status:    z.enum(DLT_STATUSES).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export type CreateDltTemplateBody = z.infer<typeof createDltTemplateBody>;
export type UpdateDltTemplateBody = z.infer<typeof updateDltTemplateBody>;
