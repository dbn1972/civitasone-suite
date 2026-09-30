import { z } from "zod";

export const createLeaveTypeBody = z.object({
  code:         z.string().min(1).max(16),
  name:         z.string().min(1).max(128),
  maxDays:      z.number().int().nonnegative().default(0),
  isEncashable: z.boolean().default(false),
  carryForward: z.boolean().default(false),
  // HIGH fix (LOP-ignores-leave-type bug): basis points (0-10000) of each
  // approved day of this type that counts toward payroll Loss-of-Pay -- see
  // schema.ts's hrmsLeaveTypes.lopFractionBps doc comment. Defaults to
  // 10000 (fully counts as LOP) when the caller doesn't specify it, the
  // same fail-safe as the column default, so a type created without an
  // explicit classification is never silently treated as paid.
  lopFractionBps: z.number().int().min(0).max(10000).default(10000),
});
export type CreateLeaveTypeBody = z.infer<typeof createLeaveTypeBody>;

export const allocateLeaveBody = z.object({
  employeeId:  z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  // GAP-HR-LEAVE-ALLOCATE-05: the bare /^\d{4}-\d{2}$/ shape let '2026-99'
  // and '2026-15' through -- refine checks the second (two-digit) year
  // segment is actually startYear+1 mod 100, matching the real Indian FY
  // convention (fiscalYearLabel/financialYearOf, apps/web/src/lib/
  // fiscalYear.ts) this same string format is meant to encode everywhere
  // else in the app.
  fy: z.string()
    .regex(/^\d{4}-\d{2}$/, "must be YYYY-YY")
    .refine((v) => {
      const [start, end] = v.split("-");
      return Number(end) === (Number(start) + 1) % 100;
    }, "must be a real financial year (e.g. 2026-27)"),
  totalDays:   z.number().int().positive(),
});
export type AllocateLeaveBody = z.infer<typeof allocateLeaveBody>;

export const applyLeaveBody = z.object({
  employeeId:  z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  allocId:     z.string().uuid(),
  fromDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daysApplied: z.number().int().positive(),
  reason:      z.string().max(1000).optional(),
});
export type ApplyLeaveBody = z.infer<typeof applyLeaveBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const rejectLeaveBody = z.object({ reason: z.string().min(1) });
export type RejectLeaveBody = z.infer<typeof rejectLeaveBody>;

export const leaveQueryParams = z.object({
  empId: z.string().uuid().optional(),
});
