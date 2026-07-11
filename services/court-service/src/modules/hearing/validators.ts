import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const hearingIdParam = z.object({ id: z.string().uuid() });

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
