// GAP-HR-SF09A-017 / GAP-HR-SF09A-001: kept in sync with the identical
import { PAYROLL_SALARY_ADMIN_ROLES } from "@/lib/auth/workRoles";
// arrays in ../../salary-slips/_salaryAdminRoles.ts and
// ../../salary-slips/[id]/_salaryAdminRoles.ts (enforced by
// salary-admin-roles.test.ts) -- see that file's comment for why
// "finance_officer" was added, and for why this constant lives in its own
// file rather than inline in page.tsx.
export const SALARY_ADMIN_ROLES = PAYROLL_SALARY_ADMIN_ROLES;
