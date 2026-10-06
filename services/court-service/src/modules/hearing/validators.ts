import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const hearingIdParam = z.object({ id: z.string().uuid() });

/** Flat hearings day-view query (GAP-COURT-HEARINGS-03). */
export const listHearingsQuery = z.object({
  from:    z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  to:      z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD").optional(),
  status:  z.string().trim().max(24).optional(),
  benchId: z.string().uuid().optional(),
  limit:   z.coerce.number().int().min(1).max(200).default(100),
  offset:  z.coerce.number().int().min(0).default(0),
});
export type ListHearingsQuery = z.infer<typeof listHearingsQuery>;

/** Schedule a hearing on a case (§19). `scheduledAt` is an ISO-8601 instant. */
export const scheduleHearingBody = z.object({
  benchId:     z.string().uuid().optional(),
  scheduledAt: z.string().trim().datetime({ offset: true }).or(z.string().trim().datetime()),
  purpose:     z.string().trim().max(64).optional(),
});
export type ScheduleHearingBody = z.infer<typeof scheduleHearingBody>;

/** Adjourn a scheduled hearing (§20). `expectedVersion` is the optimistic-lock token. */
export const adjournHearingBody = z.object({
  reason:          z.string().trim().min(1).max(1000),
  nextDate:        z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "nextDate must be YYYY-MM-DD"),
  expectedVersion: z.coerce.number().int().min(1),
});
export type AdjournHearingBody = z.infer<typeof adjournHearingBody>;

/** Record the final outcome of a scheduled hearing (§20). `expectedVersion` is the
 *  optimistic-lock token. */
export const recordHearingOutcomeBody = z.object({
  outcome:         z.enum(["held", "cancelled"]),
  notes:           z.string().trim().max(1000).optional(),
  expectedVersion: z.coerce.number().int().min(1),
});
export type RecordHearingOutcomeBody = z.infer<typeof recordHearingOutcomeBody>;
