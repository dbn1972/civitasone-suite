/** change/release feature — shared view types (SVC-130). */
import { z } from "zod";

export type ChangeStatus =
  | "draft" | "submitted" | "approved" | "rejected"
  | "scheduled" | "in_progress" | "completed" | "rolled_back";

export type ChangeType = "standard" | "normal" | "emergency";
export type ChangeRisk = "low" | "medium" | "high";
export type PirOutcome = "success" | "rolled_back";

/**
 * GAP-CHANGE-HOME-06: enum sets mirroring the admin-service change domain
 * (services/admin-service/src/modules/change/domain.ts). Exported so the pure
 * row parser and tests can reference the exact closed vocabulary rather than a
 * silent string fallback that would make an unknown status render as "draft".
 */
export const CHANGE_STATUSES = [
  "draft", "submitted", "approved", "rejected",
  "scheduled", "in_progress", "completed", "rolled_back",
] as const;
export const CHANGE_TYPES = ["standard", "normal", "emergency"] as const;
export const CHANGE_RISKS = ["low", "medium", "high"] as const;
export const PIR_OUTCOMES = ["success", "rolled_back"] as const;

/**
 * GAP-CHANGE-HOME-06: Zod schema for a single change-request row as returned by
 * GET /v1/admin/change/requests[/:id]. `id` and `status` are the fields a
 * backend shape-drift would most dangerously corrupt (a missing id or a renamed
 * status previously defaulted to "" / "draft" and silently offered draft
 * actions), so they are validated strictly: a non-UUID id or an unknown status
 * fails the row and it is dropped rather than mis-rendered. Nullable/optional
 * fields are coerced to the view shape without inventing values.
 */
export const changeRequestSchema = z.object({
  id: z.string().uuid(),
  title: z.string().default(""),
  type: z.enum(CHANGE_TYPES),
  risk: z.enum(CHANGE_RISKS),
  affectedServices: z.array(z.string()).default([]),
  description: z.string().default(""),
  rollbackPlan: z.string().min(1).nullish().transform((v) => v ?? null),
  status: z.enum(CHANGE_STATUSES),
  requestedBy: z.string().default(""),
  approvedBy: z.string().min(1).nullish().transform((v) => v ?? null),
  approvedAt: z.string().min(1).nullish().transform((v) => v ?? null),
  rejectedReason: z.string().min(1).nullish().transform((v) => v ?? null),
  windowStart: z.string().min(1).nullish().transform((v) => v ?? null),
  windowEnd: z.string().min(1).nullish().transform((v) => v ?? null),
  releaseNotes: z.string().min(1).nullish().transform((v) => v ?? null),
  pirOutcome: z.enum(PIR_OUTCOMES).nullish().transform((v) => v ?? null),
  pirNotes: z.string().min(1).nullish().transform((v) => v ?? null),
  pirAt: z.string().min(1).nullish().transform((v) => v ?? null),
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
});

export const changeAuditEntrySchema = z.object({
  id: z.string().default(""),
  fromStatus: z.string().min(1).nullish().transform((v) => v ?? null),
  toStatus: z.string().default(""),
  actorId: z.string().default(""),
  note: z.string().min(1).nullish().transform((v) => v ?? null),
  at: z.string().default(""),
});

export const changeFreezeSchema = z.object({
  id: z.string().default(""),
  name: z.string().default(""),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  reason: z.string().default(""),
});

export interface ChangeRequest {
  id: string;
  title: string;
  type: ChangeType;
  risk: ChangeRisk;
  affectedServices: string[];
  description: string;
  rollbackPlan: string | null;
  status: ChangeStatus;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  releaseNotes: string | null;
  pirOutcome: PirOutcome | null;
  pirNotes: string | null;
  pirAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeAuditEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string;
  note: string | null;
  at: string;
}

export interface ChangeDetail {
  data: ChangeRequest;
  audit: ChangeAuditEntry[];
}

export interface ChangeFreeze {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}
