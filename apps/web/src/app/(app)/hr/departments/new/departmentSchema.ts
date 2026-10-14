import { z } from "zod";

/**
 * Client-side mirror of hrms-service's department `createDeptBody`
 * (services/hrms-service/src/modules/employee/masters-routes.ts): code 1-20,
 * name 2-200, type 1-40 when given. The other body fields (parentId, govtTier,
 * headEmployeeId) are picked from fixed option lists / the entity picker, so
 * they are not re-validated here. The server stays the authority.
 */
export const departmentSchema = z.object({
  code: z.string().trim().min(1, "deptCodeRequired").max(20, "deptCodeMax"),
  name: z.string().trim().min(2, "deptNameMin").max(200, "deptNameMax"),
  type: z.string().trim().max(40, "deptTypeMax"),
});

export type DepartmentErrors = Partial<Record<keyof z.infer<typeof departmentSchema>, string>>;

export function validateDepartment(input: Record<keyof z.infer<typeof departmentSchema>, string>): DepartmentErrors {
  const parsed = departmentSchema.safeParse(input);
  if (parsed.success) return {};
  const errors: DepartmentErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof DepartmentErrors;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
