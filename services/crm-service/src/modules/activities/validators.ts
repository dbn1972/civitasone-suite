import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

/**
 * AC-001 typed activities. The six BRD activity types plus the two legacy types
 * this service already emits internally:
 *  - 'email' / 'complaint' remain creatable (complaint drives the CRM->helpdesk
 *    case-open chain in the consumer; removing it would break that flow).
 *  - 'comm_delivery' is written ONLY by the notification-delivery consumer, so it
 *    is intentionally NOT in the user-facing create enum.
 */
export const ACTIVITY_TYPES = [
  "task", "call", "meeting", "appointment", "note", "reminder", "email", "complaint",
] as const;

export const createActivityBody = z.object({
  actorName: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(2000),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  type: z.enum(ACTIVITY_TYPES).default("note"),
  subject: z.string().max(200).optional(),
  status: z.enum(["open", "completed", "cancelled"]).default("open"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // AC-001: reminder fire time (any type may carry one; primary for type='reminder').
  remindAt: z.string().datetime().optional(),
  // AC-001: venue for meetings/appointments.
  location: z.string().max(500).optional(),
});
export type CreateActivityBody = z.infer<typeof createActivityBody>;

/**
 * The per-record activity timeline is REQUIRED to be scoped to one subject.
 * GET /v1/crm/activities without subjectType+subjectId used to return the whole
 * tenant's activities, which the FE embeds on every contact/account page — a
 * same-tenant leak of unrelated notes/PII. subjectType maps to a column:
 * contact->contact_id, deal->deal_id, account->account_id.
 */
export const ACTIVITY_SUBJECT_TYPES = ["contact", "deal", "account"] as const;
export const listActivitiesQuery = z.object({
  subjectType: z.enum(ACTIVITY_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuery>;

// P1-3 activity completion: status (and optional explicit completedAt).
export const updateActivityBody = z.object({
  status: z.enum(["open", "completed", "cancelled"]).optional(),
  completedAt: z.string().datetime().nullable().optional(),
}).refine((b) => b.status !== undefined || b.completedAt !== undefined, {
  message: "at least one field required",
});
export type UpdateActivityBody = z.infer<typeof updateActivityBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const activityViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorName: z.string(),
  text: z.string(),
  contactId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  type: z.string(),
  subject: z.string().nullable().optional(),
  status: z.string(),
  dueDate: z.string().nullable().optional(),
  remindAt: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const activitiesListSchema = paginatedSchema(activityViewSchema);
