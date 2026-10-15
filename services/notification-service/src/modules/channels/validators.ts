import { z } from "zod";

export const channelType = z.enum(["email", "sms", "push", "in_app", "whatsapp"]);

export const createChannelBody = z.object({
  type:      channelType,
  name:      z.string().min(1).max(128),
  isDefault: z.boolean().default(false),
  enabled:   z.boolean().default(true),
});
export type CreateChannelBody = z.infer<typeof createChannelBody>;

// GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01: enable/disable a channel. The
// reason is mandatory when DISABLING (a disabled default channel stops
// deliveries), and is carried into the audit record.
export const setChannelEnabledBody = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500).optional(),
}).refine((b) => b.enabled || !!b.reason, { message: "reason is required to disable a channel", path: ["reason"] });
export type SetChannelEnabledBody = z.infer<typeof setChannelEnabledBody>;

export const channelIdParam = z.object({ id: z.string().uuid() });
