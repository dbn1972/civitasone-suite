/**
 * STAFF_ROLES: every internal HR / office principal plus the bare `employee`
 * role. It deliberately EXCLUDES `citizen`, `service_account` and any other
 * external principal, so a citizen-portal token that is tenant-valid still
 * gets 403 on staff-only self-service routes (pulse surveys, goals,
 * leaderboard, assistant, devices, travel/expense, Form 16 verify, ...).
 *
 * Mirrors the /hr layout boundary (apps/web/src/lib/auth/workRoles.ts
 * HR_ROLES) - keep in sync if that list changes.
 */
export const STAFF_ROLES: string[] = [
  "hr_admin",
  "hr_officer",
  "payroll_officer",
  "payroll_admin",
  "tenant_admin",
  "platform_admin",
  "super_admin",
  "manager",
  "employee",
  "icc_member",
  "admin",
  "officer",
  "finance_officer",
  "finance_admin",
];
