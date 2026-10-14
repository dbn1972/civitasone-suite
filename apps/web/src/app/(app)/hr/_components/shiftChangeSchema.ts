import { z } from "zod";

/**
 * Client-side mirror of hrms-service's POST /v1/hrms/shift-requests body
 * (services/hrms-service/src/modules/attendance/routes.ts, the
 * `app.post("/v1/hrms/shift-requests")` handler): employeeId uuid,
 * currentShift 1-120, requestedShift 1-120, effectiveDate YYYY-MM-DD,
 * reason max 500 (optional). The server stays the authority; this only
 * catches the obvious rejections inline.
 */
export const shiftChangeSchema = z.object({
  employeeId: z.string().uuid("Choose an employee before submitting."),
  currentShift: z.string().min(1, "Choose the current shift.").max(120, "Current shift must be 120 characters or fewer."),
  requestedShift: z.string().min(1, "Choose the requested shift.").max(120, "Requested shift must be 120 characters or fewer."),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the effective date."),
  reason: z.string().max(500, "Reason must be 500 characters or fewer."),
});

export type ShiftChangeErrors = Partial<Record<keyof z.infer<typeof shiftChangeSchema>, string>>;

export function validateShiftChange(input: Record<keyof z.infer<typeof shiftChangeSchema>, string>): ShiftChangeErrors {
  const parsed = shiftChangeSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: ShiftChangeErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof ShiftChangeErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
