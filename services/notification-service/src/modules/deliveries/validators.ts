import { z } from "zod";

export const sendNotificationBody = z.object({
  templateId:  z.string().uuid(),
  recipientId: z.string().uuid().optional(),
  recipient:   z.string().min(1).optional(),
  channel:     z.enum(["email", "sms", "push", "in_app", "whatsapp"]).optional(),
  eventType:   z.string().optional(),
  variables:   z.record(z.string()).optional(),
}).refine((v) => v.recipient || v.recipientId, { message: "recipient or recipientId required" });
export type SendNotificationBody = z.infer<typeof sendNotificationBody>;

export const deliveryIdParam = z.object({ id: z.string().uuid() });
