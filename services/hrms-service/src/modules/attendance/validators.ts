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
}).refine(
  (data) => data.attendanceDate <= new Date().toISOString().slice(0, 10),
  { message: "attendanceDate cannot be in the future", path: ["attendanceDate"] }
);

export const markAttendanceBody = z.object({
  records: z.array(attendanceRecord).min(1).max(200),
});
export type MarkAttendanceBody = z.infer<typeof markAttendanceBody>;

export const attendanceQueryParams = z.object({
  empId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const regularisationCreateBody = z.object({
  // GAP-HR-ATTENDANCE-REGULARISATION-01: optional. An employee raising their
  // own request omits it (the server derives it from the caller's linked
  // employee record); HR must name the employee they raise it for (checked at
  // the route, which knows the caller's role).
  employeeId:      z.string().uuid().optional(),
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  requestedStatus: z.enum(["present", "absent", "half_day"]),
  reason:          z.string().min(1),
}).refine(
  (data) => data.date <= new Date().toISOString().slice(0, 10),
  { message: "regularisation date cannot be in the future", path: ["date"] }
);
export type RegularisationCreateBody = z.infer<typeof regularisationCreateBody>;
/** A regularisation body after the route has resolved who it is for. */
export type ResolvedRegularisationBody = Omit<RegularisationCreateBody, "employeeId"> & { employeeId: string };

// DEF-AT-001: lock / unlock an attendance period (payroll cut-off).
export const periodLockBody = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM"),
  reason: z.string().max(500).optional(),
});
export type PeriodLockBody = z.infer<typeof periodLockBody>;


// GAP-HR-SHIFTS-01: shift definition create/update. HH:MM (24h). A shift may run
// past midnight (night shift) so end < start is legal; start === end is not
// (a zero/24h shift is almost certainly a typo).
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (24-hour)");
export const createShiftBody = z.object({
  name:      z.string().trim().min(1).max(80),
  startTime: hhmm,
  endTime:   hhmm,
  graceMins: z.number().int().min(0).max(240).default(0),
}).refine((v) => v.startTime !== v.endTime, { message: "startTime and endTime must differ", path: ["endTime"] });
export type CreateShiftBody = z.infer<typeof createShiftBody>;

export const updateShiftBody = z.object({
  name:      z.string().trim().min(1).max(80).optional(),
  startTime: hhmm.optional(),
  endTime:   hhmm.optional(),
  graceMins: z.number().int().min(0).max(240).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });
export type UpdateShiftBody = z.infer<typeof updateShiftBody>;
