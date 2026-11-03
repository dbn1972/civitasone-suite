/**
 * UAT Phase 2 C8 (security, roles-11021730 R1): roles that may open the payroll
 * RUN screens (/hr/payroll, /hr/payroll/runs, /hr/payroll/[id]). Mirrors
 * payroll-service payroll/routes.ts RUN_READER_ROLES: payroll staff + hr_admin.
 * finance_officer is deliberately NOT here — the run register carries every
 * employee's pay, and the service now refuses it (403). Kept in its own module
 * (not roleGuard.ts) so page tests that mock roleGuard keep the real list.
 */
export const PAYROLL_RUN_READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];
