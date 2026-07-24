import { z } from "zod";

export const createSessionBody = z.object({
  title:       z.string().min(1).max(256),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime:     z.string().regex(/^\d{2}:\d{2}$/).optional(),
  venue:       z.string().max(256).optional(),
  capacity:    z.number().int().positive().max(10000).default(30),
});
export type CreateSessionBody = z.infer<typeof createSessionBody>;

export const approveNominationBody = z.object({
  sessionId: z.string().uuid(),
});
export type ApproveNominationBody = z.infer<typeof approveNominationBody>;

export const markAttendanceBody = z.object({
  employeeId: z.string().uuid(),
  status:     z.enum(["present", "absent", "excused"]).default("present"),
});
export type MarkAttendanceBody = z.infer<typeof markAttendanceBody>;
