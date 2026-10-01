// GAP-HR-SF09A-017: kept in sync with the identical arrays in
// ./[id]/_salaryAdminRoles.ts and ../slips/[id]/_salaryAdminRoles.ts
// (enforced by salary-admin-roles.test.ts) -- added "finance_officer" to
// match the sibling PENSIONER_VIEW_ROLES (../pensioners/page.tsx), which
// already includes it for the same reason: GET /v1/payroll/salary-slips
// already admits finance_officer server-side (payroll-service
// payroll/routes.ts), this array was just never updated to match.
//
// Lives in its own file (not inline in page.tsx, unlike the analogous
// TRAINING_ADMIN_ROLES pattern) because Next.js's App Router build rejects
// any named export from a page.tsx other than its own fixed set --
// salary-admin-roles.test.ts needs a real import to check the 3 copies
// haven't drifted, so this one constant can't just be a private const.
export const SALARY_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
