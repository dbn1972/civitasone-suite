import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { APPEAL_TYPES, ORDER_TYPES } from "./domain.js";

export const idParam = z.object({ id: z.string().uuid() });

export const fileAppealBody = z.object({
  applicationId: z.string().uuid().optional(),
  decisionRef:   safeText({ max: 128 }).optional(),
  citizenId:     z.string().uuid().optional(),
  appealType:    z.enum(APPEAL_TYPES).default("appeal"),
  grounds:       safeText({ max: 4000, multiline: true }),
  decisionDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "decisionDate must be YYYY-MM-DD"),
  windowDays:    z.number().int().min(1).max(3650).optional(),
});
export type FileAppealBody = z.infer<typeof fileAppealBody>;

export const assignBody = z.object({
  appellateAuthorityId: z.string().uuid(),
});
export type AssignBody = z.infer<typeof assignBody>;

export const transferRecordsBody = z.object({
  note: safeText({ max: 500, multiline: true }).optional(),
});

export const scheduleHearingBody = z.object({
  scheduledAt: z.string().datetime().optional(),
  mode:        z.enum(["in_person", "video", "written"]).default("in_person"),
});
export type ScheduleHearingBody = z.infer<typeof scheduleHearingBody>;

export const recordHearingBody = z.object({
  hearingId: z.string().uuid(),
  record:    safeText({ max: 8000, multiline: true }),
});
export type RecordHearingBody = z.infer<typeof recordHearingBody>;

/** Maker step: prepare (draft) the appellate order. */
export const prepareOrderBody = z.object({
  orderType: z.enum(ORDER_TYPES),
  orderNote: safeText({ max: 8000, multiline: true }),
  remandTo:  z.string().uuid().optional(),
});
export type PrepareOrderBody = z.infer<typeof prepareOrderBody>;

/** Checker step: issue the prepared order (no body needed). */
export const issueOrderBody = z.object({
  note: safeText({ max: 500, multiline: true }).optional(),
});
