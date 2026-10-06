import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createCommitteeBody = z.object({
  name:     z.string().min(1),
  purpose:  z.string().optional(),
  chairRef: z.string().uuid(),
});
export type CreateCommitteeBody = z.infer<typeof createCommitteeBody>;

export const createMeetingBody = z.object({
  title:  z.string().min(1),
  whenAt: z.string().datetime(),
  venue:  z.string().optional(),
});
export type CreateMeetingBody = z.infer<typeof createMeetingBody>;

export const createResolutionBody = z.object({
  body:        z.string().min(1),
  actionOwner: z.string().uuid().optional(),
  dueDate:     z.string().optional(),
});
export type CreateResolutionBody = z.infer<typeof createResolutionBody>;

export const minutesBody = z.object({
  minutesUrl: z.string().url(),
});
export type MinutesBody = z.infer<typeof minutesBody>;

export const recordAttendanceBody = z.object({
  memberRef: z.string().uuid(),
  role:      z.string().optional().default("member"),
  attended:  z.boolean(),
});
export type RecordAttendanceBody = z.infer<typeof recordAttendanceBody>;

// GAP-ESTAB-COMPLIANCE-03: mark a compliance register item as complied.
// `remarks` is required so there is an auditable reason for the closure.
export const markComplianceBody = z.object({
  remarks: z.string().trim().min(1).max(1000),
});
export type MarkComplianceBody = z.infer<typeof markComplianceBody>;
