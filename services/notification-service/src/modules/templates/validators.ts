import { z } from "zod";

export const updateTemplateBody = z.object({
  channel: z.enum(["email", "sms", "push", "in_app"]).optional(),
  name:    z.string().min(1).max(128).optional(),
  subject: z.string().max(256).optional(),
  body:    z.string().min(1).optional(),
});
export type UpdateTemplateBody = z.infer<typeof updateTemplateBody>;

export const createTemplateBody = z.object({
  channel: z.enum(["email", "sms", "push", "in_app"]),
  name:    z.string().min(1).max(128),
  subject: z.string().max(256).optional(),
  body:    z.string().min(1),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBody>;

export const setPrefsBody = z.object({
  eventType: z.string().min(1).max(128),
  inApp:     z.boolean().default(true),
  email:     z.boolean().default(true),
  push:      z.boolean().default(false),
});
export type SetPrefsBody = z.infer<typeof setPrefsBody>;

// Update an existing preference row's channels by its row id (tenant-admin
// "Save changes" on the notification preferences screen). At least one channel
// must be present so an empty PATCH is rejected rather than silently no-op.
export const prefIdParam = z.object({ id: z.string().uuid() });
export const updatePrefsBody = z.object({
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  push:  z.boolean().optional(),
}).refine((b) => b.inApp !== undefined || b.email !== undefined || b.push !== undefined, {
  message: "at least one of inApp, email, push required",
});
export type UpdatePrefsBody = z.infer<typeof updatePrefsBody>;

export const templateIdParam = z.object({ id: z.string().uuid() });
export const userIdParam     = z.object({ userId: z.string().uuid() });
