import { z } from "zod";

/**
 * Client-side mirror of hrms-service's employee-type `createBody`
 * (services/hrms-service/src/modules/employee/employee-types-routes.ts): code 1-24,
 * name 2-120, description max 500, defaultProbationMonths a non-negative integer,
 * maxContractMonths a positive integer when set. The enum fields are picked from fixed
 * option lists and the flags are checkboxes, so they are not re-validated here. The server
 * stays the authority. Messages are `hrFormErrors2` keys, never display text.
 */
export const employeeTypeSchema = z.object({
  code: z.string().trim().min(1, "empTypeCodeRequired").max(24, "empTypeCodeMax"),
  name: z.string().trim().min(2, "empTypeNameMin").max(120, "empTypeNameMax"),
  description: z.string().max(500, "empTypeDescriptionMax"),
  defaultProbationMonths: z.number().int("empTypeProbationWhole").nonnegative("empTypeProbationNegative"),
  maxContractMonths: z.number().int("empTypeContractWhole").positive("empTypeContractPositive").nullable(),
});

export type EmployeeTypeErrors = Partial<Record<keyof z.infer<typeof employeeTypeSchema>, string>>;

export function validateEmployeeType(input: z.infer<typeof employeeTypeSchema>): EmployeeTypeErrors {
  const parsed = employeeTypeSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: EmployeeTypeErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof EmployeeTypeErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
