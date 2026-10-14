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
  leaveTypeId: z.string().min(1, "leaveTypeRequired"),
  employeeType: z.enum(EMPLOYEE_TYPES, { message: "employeeTypeRequired" }),
  maxDaysPerYear: z.number().int("daysPerYearWhole").min(0, "daysPerYearRange").max(730, "daysPerYearRange"),
  countMethod: z.enum(["calendar", "working_days"], { message: "countMethodRequired" }),
  maxAccumulation: z.number().int("maxAccumulationWhole").min(0, "maxAccumulationNegative"),
  maxContinuousDays: z.number().int("maxContinuousWhole").min(1, "maxContinuousRange").max(730, "maxContinuousRange"),
  minServiceMonths: z.number().int("minServiceWhole").min(0, "minServiceNegative"),
  genderRestriction: z.enum(["male", "female", ""], { message: "genderInvalid" }),
  requiresMedicalCertAfterDays: z.number().int("medCertWhole").min(1, "medCertMin"),
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
