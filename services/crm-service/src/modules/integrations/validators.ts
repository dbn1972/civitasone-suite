/** AC-004 zod validators — email/calendar linking substrate (framework only). */
import { z } from "zod";

export const PROVIDERS = ["google", "o365", "imap", "caldav"] as const;
export const SYNC_KINDS = ["email", "meeting"] as const;
export const SYNC_SUBJECT_TYPES = ["contact", "account", "deal"] as const;

export const connectLinkedAccountBody = z.object({
  provider: z.enum(PROVIDERS),
  externalEmail: z.string().email().max(320),
  scopes: z.array(z.string().max(200)).max(50).default([]),
});
export type ConnectLinkedAccountBody = z.infer<typeof connectLinkedAccountBody>;

export const linkSyncedItemBody = z.object({
  linkedAccountId: z.string().uuid(),
  kind: z.enum(SYNC_KINDS),
  externalId: z.string().min(1).max(320),
  subjectType: z.enum(SYNC_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  occurredAt: z.string().datetime().optional(),
});
export type LinkSyncedItemBody = z.infer<typeof linkSyncedItemBody>;

export const idParam = z.object({ id: z.string().uuid() });
