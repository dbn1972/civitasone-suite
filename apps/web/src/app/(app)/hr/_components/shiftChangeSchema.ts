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
  employeeId: z.string().uuid("employeeRequired"),
  currentShift: z.string().min(1, "currentShiftRequired").max(120, "currentShiftMax"),
  requestedShift: z.string().min(1, "requestedShiftRequired").max(120, "requestedShiftMax"),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDateRequired"),
  reason: z.string().max(500, "reasonMax500"),
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
