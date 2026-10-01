// GAP-HR-SF09A-017 / GAP-HR-SF09A-001: kept in sync with the identical
// arrays in ../_salaryAdminRoles.ts and ../../slips/[id]/_salaryAdminRoles.ts
// (enforced by salary-admin-roles.test.ts) -- see ../_salaryAdminRoles.ts's
// comment for why "finance_officer" was added, and for why this constant
// lives in its own file rather than inline in page.tsx.
export const SALARY_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
