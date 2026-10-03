import { z } from "zod";
import { LEAVE_DAY_PARTS } from "./domain.js";

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
  // GAP-HR-LEAVE-ALLOCATE-01: why this entitlement is being granted. Optional
  // for API callers (cross-service contract unchanged); the web form requires
  // it, and it is mandatory whenever exceedMax is set. Recorded in the audit.
  reason:      z.string().trim().min(1).max(500).optional(),
  // GAP-HR-LEAVE-ALLOCATE-03: an allocation above the leave type's policy
  // maxDays is refused unless the caller explicitly overrides (pro-rated or
  // special grants are legitimate) AND gives a reason.
  exceedMax:   z.boolean().optional(),
});
export type AllocateLeaveBody = z.infer<typeof allocateLeaveBody>;

export const applyLeaveBody = z.object({
  employeeId:  z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  allocId:     z.string().uuid(),
  fromDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // GAP-HR-LEAVE-APPLY-05: a whole-day request stays an integer; a half-day /
  // short-leave request (dayPart != 'full') is exactly 0.5 on a single date.
  // Whether the tenant has enabled either is checked server-side in routes.ts
  // (assertDayPartAllowed) -- the shape alone cannot know the tenant policy.
  daysApplied: z.number().positive(),
  dayPart:     z.enum(LEAVE_DAY_PARTS).default("full"),
  reason:      z.string().max(1000).optional(),
}).superRefine((v, ctx) => {
  if (v.dayPart === "full") {
    if (!Number.isInteger(v.daysApplied)) {
      ctx.addIssue({ code: "custom", path: ["daysApplied"], message: "must be a whole number of days unless a half-day or short leave is selected" });
    }
  } else {
    if (v.daysApplied !== 0.5) {
      ctx.addIssue({ code: "custom", path: ["daysApplied"], message: "a half-day or short leave counts as exactly 0.5 day" });
    }
    if (v.fromDate !== v.toDate) {
      ctx.addIssue({ code: "custom", path: ["toDate"], message: "a half-day or short leave must be a single date" });
    }
  }
});
export type ApplyLeaveBody = z.infer<typeof applyLeaveBody>;

/** GAP-HR-LEAVE-APPLY-05: PUT body of the per-tenant half-day / short-leave switch. */
export const leaveTenantConfigBody = z.object({
  halfDayEnabled:    z.boolean(),
  shortLeaveEnabled: z.boolean(),
});
export type LeaveTenantConfigBody = z.infer<typeof leaveTenantConfigBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const rejectLeaveBody = z.object({ reason: z.string().min(1) });
export type RejectLeaveBody = z.infer<typeof rejectLeaveBody>;

export const leaveQueryParams = z.object({
  empId: z.string().uuid().optional(),
});
