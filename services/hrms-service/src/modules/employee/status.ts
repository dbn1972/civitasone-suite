import { z } from "zod";

// P1-5: the single canonical employee-status contract. Lowercase only, enforced
// at the data layer by the CHECK constraint in migration 0025 and validated here
// for any write path. Read models MUST return these raw values (no "Active"
// remap) so the UI never has to normalise casing.
//
// "no_show" was added to the DB-level hrms_employees_status_check constraint by
// migration 0130 (PR #898); it is included here too so this app-level contract
// matches the DB CHECK set exactly, rather than lagging behind it as a stale subset.
export const EMPLOYEE_STATUSES = [
  "probation",
  "confirmed",
  "on_leave",
  "suspended",
  "deputation",
  "retired",
  "separated",
  "terminated",
  "no_show",
] as const;

export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const employeeStatusEnum = z.enum(EMPLOYEE_STATUSES);

// Currently-serving statuses (used for "Active" headcount).
export const SERVING_STATUSES: ReadonlySet<EmployeeStatus> = new Set([
  "probation",
  "confirmed",
  "deputation",
]);

export function isEmployeeStatus(s: string): s is EmployeeStatus {
  return (EMPLOYEE_STATUSES as readonly string[]).includes(s);
}

// SEC (hrms status-integrity fix): permanent-exit statuses. An employee in
// one of these has left the organisation for good — no further lifecycle
// write (re-confirm, re-activate, generic profile edit, attendance) should
// ever be permitted once here. Deliberately NOT the full complement of
// SERVING_STATUSES: on_leave/suspended are temporary (the employee can
// return) and no_show has its own dedicated reversal workflow
// (POST /:id/reverse-no-show) — neither belongs in a "permanently gone" set.
export const EXITED_STATUSES: ReadonlySet<EmployeeStatus> = new Set([
  "terminated",
  "separated",
  "retired",
]);

export function isExitedStatus(s: string): boolean {
  return (EXITED_STATUSES as ReadonlySet<string>).has(s);
}
