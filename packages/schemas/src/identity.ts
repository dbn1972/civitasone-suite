import { z } from "zod";
import { uuidSchema } from "./common.js";

export const SYNC_MAILBOXES = [
  "payments",
  "journals",
  "employees",
  "leave_requests",
  "attendance",
  "indents",
  "purchase_orders",
  "approvals",
  "crm_contacts",
  "crm_deals",
  "helpdesk_tickets",
  "projects",
  "estab_files",
  "mis_metrics",
  "notifications",
  "applications",
  "grievances",
] as const;

export const syncMailboxSchema = z.enum(SYNC_MAILBOXES);

export const deviceRegisterRequestSchema = z.object({
  deviceId: uuidSchema,
  platform: z.enum(["web", "ios", "android", "desktop"]),
  label: z.string().min(1),
  fingerprint: z.string().min(8),
});

export const deviceRegisterResponseSchema = z.object({
  deviceId: uuidSchema,
  trustToken: z.string().min(1),
  trustLevel: z.enum(["unknown", "recognized", "trusted", "step_up_required"]),
});

export const stepUpResponseSchema = z.object({
  stepUpToken: uuidSchema,
  expiresAt: z.string().datetime(),
});

export const syncMutationSchema = z.object({
  clientMutationId: uuidSchema,
  operation: z.enum(["create", "update", "delete"]),
  entityId: uuidSchema,
  payload: z.record(z.unknown()).default({}),
  clientUpdatedAt: z.string(),
});

export const syncPushRequestSchema = z.object({
  deviceId: uuidSchema,
  mailbox: syncMailboxSchema,
  cursor: z.string(),
  mutations: z.array(syncMutationSchema).max(200),
});

export const syncPushResponseSchema = z.object({
  mailbox: z.string(),
  cursor: z.string(),
  applied: z.array(uuidSchema),
  conflicts: z.array(z.object({ clientMutationId: uuidSchema, reason: z.string() })),
});

export const syncPullRequestSchema = z.object({
  deviceId: uuidSchema,
  mailbox: syncMailboxSchema,
  cursor: z.string(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const syncEntitySchema = z.object({
  id: uuidSchema,
  operation: z.enum(["upsert", "delete"]),
  data: z.record(z.unknown()).optional(),
  updatedAt: z.string(),
  etag: z.string().optional(),
});

export const syncPullResponseSchema = z.object({
  mailbox: z.string(),
  cursor: z.string(),
  hasMore: z.boolean(),
  entities: z.array(syncEntitySchema),
});
