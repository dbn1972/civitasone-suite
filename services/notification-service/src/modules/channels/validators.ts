import { z } from "zod";

export const channelType = z.enum(["email", "sms", "push", "in_app", "whatsapp"]);

export const createChannelBody = z.object({
  type:      channelType,
  name:      z.string().min(1).max(128),
  isDefault: z.boolean().default(false),
  enabled:   z.boolean().default(true),
});
export type CreateChannelBody = z.infer<typeof createChannelBody>;

export const channelIdParam = z.object({ id: z.string().uuid() });
