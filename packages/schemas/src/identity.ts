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
  // SYN-1c: the client's last-known etag for this entity. When present, the
  // server rejects the mutation with a conflict if the entity has advanced
  // past this version. Omitted for first-time creates.
  baseEtag: z.string().optional(),
});

export const syncPushRequestSchema = z.object({
  deviceId: uuidSchema,
  mailbox: syncMailboxSchema,
  cursor: z.string(),
  mutations: z.array(syncMutationSchema).max(200),
});

// SYN-1d: explicit per-mutation outcome so a mixed batch (some applied, some
// rejected) is represented precisely instead of all-or-nothing.
export const syncMutationResultSchema = z.object({
  clientMutationId: uuidSchema,
  status: z.enum(["applied", "conflict", "failed"]),
  etag: z.string().optional(),
  /** current server state on conflict, so the client can resolve */
  serverData: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
});

export const syncPushResponseSchema = z.object({
  mailbox: z.string(),
  cursor: z.string(),
  applied: z.array(uuidSchema),
  conflicts: z.array(z.object({ clientMutationId: uuidSchema, reason: z.string() })),
  // Additive: precise per-mutation results (SYN-1d). Older clients keep reading
  // applied/conflicts; newer clients prefer results.
  results: z.array(syncMutationResultSchema).default([]),
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
