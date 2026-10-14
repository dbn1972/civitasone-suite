import { z } from "zod";

/**
 * Client-side mirror of hrms-service's `createPolicyBody`
 * (services/hrms-service/src/modules/leave/policy-admin-routes.ts, used by
 * POST /v1/hrms/admin/leave-policies): maxDaysPerYear int 0-730,
 * maxAccumulation int >= 0, maxContinuousDays int 1-730, minServiceMonths
 * int >= 0, requiresMedicalCertAfterDays int >= 1, employeeType / countMethod /
 * genderRestriction enums. leaveTypeId is a uuid server-side, but here it only
 * has to be chosen: the value always comes from the server-provided option
 * list, so it is not re-checked for uuid shape. The server stays the authority.
 */
export const EMPLOYEE_TYPES = [
  "permanent", "contractual", "vendor_deputed", "deputation", "consultant",
  "temporary", "intern", "apprentice", "volunteer",
] as const;

export const leavePolicySchema = z.object({
  leaveTypeId: z.string().min(1, "Choose a leave type."),
  employeeType: z.enum(EMPLOYEE_TYPES, { message: "Choose an employee type." }),
  maxDaysPerYear: z.number().int("Days per year must be a whole number.").min(0, "Days per year must be 0-730.").max(730, "Days per year must be 0-730."),
  countMethod: z.enum(["calendar", "working_days"], { message: "Choose a count method." }),
  maxAccumulation: z.number().int("Maximum accumulation must be a whole number.").min(0, "Maximum accumulation cannot be negative."),
  maxContinuousDays: z.number().int("Maximum continuous days must be a whole number.").min(1, "Maximum continuous days must be 1-730.").max(730, "Maximum continuous days must be 1-730."),
  minServiceMonths: z.number().int("Minimum service must be a whole number of months.").min(0, "Minimum service cannot be negative."),
  genderRestriction: z.enum(["male", "female", ""], { message: "Choose a valid gender restriction." }),
  requiresMedicalCertAfterDays: z.number().int("Medical certificate threshold must be a whole number of days.").min(1, "Medical certificate threshold must be at least 1 day."),
});

export type LeavePolicyErrors = Partial<Record<keyof z.infer<typeof leavePolicySchema>, string>>;

export function validateLeavePolicy(input: Record<string, unknown>): LeavePolicyErrors {
  const parsed = leavePolicySchema.safeParse(input);
  if (parsed.success) return {};
  const errors: LeavePolicyErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof LeavePolicyErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
