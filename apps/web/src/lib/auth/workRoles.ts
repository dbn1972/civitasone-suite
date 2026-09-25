export const PROPOSAL_WRITE_ROLES = [
  "works_admin",
  "works_operator",
  "super_admin",
  "dao",
  "do",
  "sdo",
  "section_officer",
] as const;

/**
 * UX gate for the finance module's nav entry + `/finance/*` layout (Medium
 * finding: finance screens rendered for every role — the server-side
 * boundary already 403s a non-finance role on every endpoint, this list
 * just decides whether the UI offers the door at all).
 *
 * This is the union of every role that finance-service's own route guards
 * actually admit somewhere across its modules — re-derived from
 * services/finance-service/src/modules/**\/routes.ts's own FINANCE_ROLES/
 * READER_ROLES/APPROVER_ROLES/ADMIN_ROLES constants (grep for `_ROLES =` in
 * that tree), not assumed. Deliberately broader than the plain
 * "finance_officer/finance_admin/super_admin" triad so a role with narrower,
 * legitimate access to only SOME finance screens (an auditor reading GL, a
 * budget or procurement officer reading budget/sanction data, an accounts
 * officer approving payments, a payroll_admin hitting the PFMS salary-bill
 * bridge, a tenant/org admin) still sees the module at all — hiding it from
 * them would be a new UX regression, not a fix. "accountant" was checked
 * against this same grep and does not exist as a role anywhere in the core
 * accounting-cycle modules (only in the separate `simplified` small-office
 * mode) — finance_officer is the real role in this codebase.
 */
export const FINANCE_ROLES = [
  "finance_officer",
  "finance_admin",
  "super_admin",
  "audit_officer",
  "budget_officer",
  "procurement_officer",
  "accounts_officer",
  "payroll_admin",
  "tenant_admin",
  "admin",
] as const;
