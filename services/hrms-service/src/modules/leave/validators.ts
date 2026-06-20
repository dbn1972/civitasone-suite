import { z } from "zod";

export const createLeaveTypeBody = z.object({
  code:         z.string().min(1).max(16),
  name:         z.string().min(1).max(128),
  maxDays:      z.number().int().nonnegative().default(0),
  isEncashable: z.boolean().default(false),
  carryForward: z.boolean().default(false),
});
export type CreateLeaveTypeBody = z.infer<typeof createLeaveTypeBody>;

export const allocateLeaveBody = z.object({
  employeeId:  z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  fy:          z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-YY"),
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

export const leaveQueryParams = z.object({
  empId: z.string().uuid().optional(),
});
