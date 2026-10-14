import { z } from "zod";

/**
 * Client-side mirror of hrms-service's POST /v1/hrms/wfh-requests body
 * (services/hrms-service/src/modules/attendance/routes.ts, the
 * `app.post("/v1/hrms/wfh-requests")` handler): employeeId uuid, fromDate and
 * toDate YYYY-MM-DD with toDate >= fromDate, reason max 500 (optional). The
 * server stays the authority (it also enforces the DoPT pay-level / weekly
 * cap rules); this only catches the obvious rejections inline.
 */
export const wfhRequestSchema = z
  .object({
    employeeId: z.string().uuid("Choose an employee before submitting."),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the from date."),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the to date."),
    reason: z.string().max(500, "Reason must be 500 characters or fewer."),
  })
  .refine((d) => d.toDate >= d.fromDate, { message: "To date must be on or after the from date.", path: ["toDate"] });

export type WfhRequestErrors = Partial<Record<"employeeId" | "fromDate" | "toDate" | "reason", string>>;

export function validateWfhRequest(input: Record<"employeeId" | "fromDate" | "toDate" | "reason", string>): WfhRequestErrors {
  const parsed = wfhRequestSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: WfhRequestErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof WfhRequestErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
