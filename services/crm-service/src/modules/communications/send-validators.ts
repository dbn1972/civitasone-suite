/**
 * CO-001 — zod validators for send / bulk-send communication routes.
 */
import { z } from "zod";

export const SEND_CHANNELS = ["email", "sms", "whatsapp"] as const;

export const sendCommunicationBody = z.object({
  recipientContactId: z.string().uuid(),
  templateId: z.string().uuid(),
  channel: z.enum(SEND_CHANNELS),
  variables: z.record(z.string(), z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
});
export type SendCommunicationBody = z.infer<typeof sendCommunicationBody>;

export const bulkSendCommunicationBody = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(200),
  templateId: z.string().uuid(),
  channel: z.enum(SEND_CHANNELS),
  variables: z.record(z.string(), z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
});
export type BulkSendCommunicationBody = z.infer<typeof bulkSendCommunicationBody>;
