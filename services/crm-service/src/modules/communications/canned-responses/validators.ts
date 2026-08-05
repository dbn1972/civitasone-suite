/**
 * Gap 5 — zod validators for canned-responses CRUD.
 */
import { z } from "zod";

const CANNED_CHANNELS = ["email", "sms", "whatsapp", "any"] as const;

export const createCannedResponseBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  channel: z.enum(CANNED_CHANNELS),
  category: z.string().min(1).max(100).optional(),
  shortcutKey: z.string().min(1).max(50).optional(),
});
export type CreateCannedResponseBody = z.infer<typeof createCannedResponseBody>;

export const updateCannedResponseBody = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  channel: z.enum(CANNED_CHANNELS).optional(),
  category: z.string().min(1).max(100).nullable().optional(),
  shortcutKey: z.string().min(1).max(50).nullable().optional(),
});
export type UpdateCannedResponseBody = z.infer<typeof updateCannedResponseBody>;

export const cannedResponseIdParam = z.object({ id: z.string().uuid() });

export const cannedResponseListQuery = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  channel: z.enum(CANNED_CHANNELS).optional(),
});
