import { z } from "zod";

const attendanceRecord = z.object({
  employeeId:     z.string().uuid(),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status:         z.enum(["present", "absent", "half_day", "on_leave", "holiday"]).default("present"),
  inTime:         z.string().regex(/^\d{2}:\d{2}$/).optional(),
  outTime:        z.string().regex(/^\d{2}:\d{2}$/).optional(),
  shiftId:        z.string().uuid().optional(),
  lateMins:       z.number().int().nonnegative().default(0),
  source:         z.string().default("manual"),
});

export const markAttendanceBody = z.object({
  records: z.array(attendanceRecord).min(1).max(200),
});
export type MarkAttendanceBody = z.infer<typeof markAttendanceBody>;

export const attendanceQueryParams = z.object({
  empId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const regularisationCreateBody = z.object({
  employeeId:      z.string().uuid(),
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  requestedStatus: z.enum(["present", "absent", "half_day"]),
  reason:          z.string().min(1),
});
export type RegularisationCreateBody = z.infer<typeof regularisationCreateBody>;

export const regularisationDecisionParam = z.object({
  id:       z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});
export const regularisationDecideBody = z.object({
  reason: z.string().max(2000).optional(),
});

// DEF-AT-001: lock / unlock an attendance period (payroll cut-off).
export const periodLockBody = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM"),
  reason: z.string().max(500).optional(),
});
export type PeriodLockBody = z.infer<typeof periodLockBody>;
