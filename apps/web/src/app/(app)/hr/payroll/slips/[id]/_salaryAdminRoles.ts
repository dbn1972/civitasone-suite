// GAP-HR-SF09A-017 / GAP-HR-SF09A-001: kept in sync with the identical
import { PAYROLL_PAY_DATA_ROLES } from "@/lib/auth/payrollRunRoles";
// arrays in ../../salary-slips/_salaryAdminRoles.ts and
// ../../salary-slips/[id]/_salaryAdminRoles.ts (enforced by
// salary-admin-roles.test.ts) -- see that file's comment for why
// "finance_officer" was added, and for why this constant lives in its own
// file rather than inline in page.tsx.
// UAT Phase 2 follow-up (security): per-employee slips are payroll + HR only
// (finance_officer removed; finance uses aggregate run totals).
export const SALARY_ADMIN_ROLES = PAYROLL_PAY_DATA_ROLES;
