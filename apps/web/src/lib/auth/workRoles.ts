/**
 * GAP-HR-EMPLOYEES-DETAIL-02: the narrower role list actually allowed to
 * administer an employee record -- PATCH /v1/hrms/employees/:id and the
 * Initiate Transfer/Promotion/Separation lifecycle actions are all
 * HR_ROLES-gated on the backend (employee/routes.ts), but the profile page
 * and its edit toggle used to render those controls for ANYONE who could
 * open the page at all (HR_ROLES above, which also admits "manager" and
 * "employee"). Named "hrRoles.ts" in the original gap catalog's fix step;
 * placed here instead, alongside FINANCE_ROLES/HR_ROLES/
 * PROPOSAL_WRITE_ROLES, to follow this file's own established convention
 * rather than add a second, competing home for the same kind of constant.
 * Mirrors employee/routes.ts's own HR_ROLES exactly -- keep in sync if
 * that list ever changes.
 */
export const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

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

/**
 * UX gate for every page under /hr, /hr/payroll and /hr/recruitment (all
 * three share hr/layout.tsx's single `requireAnyRole(HR_ROLES)` call, since
 * payroll and recruitment are sub-trees of the same URL prefix and layout).
 *
 * GAP-HR-SF-09a moved this list here verbatim from hr/layout.tsx's own local
 * `const HR_ROLES = [...]` — a zero-behavior-change extraction, mirroring
 * how FINANCE_ROLES/PROPOSAL_WRITE_ROLES already live in this shared file
 * instead of each layout re-declaring its own copy. See hr/layout.tsx's own
 * doc comment for the full history of *why* this list contains what it
 * does (in particular, why "employee"/"manager" are included even though
 * many individual HR-admin routes still correctly reject them).
 *
 * This list is NOT guaranteed to agree with every individual hrms-service /
 * payroll-service route's own `requireRole(ctx, ...)` list — by design, it
 * is the union of what ANY /hr sub-area needs, not what every single route
 * needs. Known disagreements between this list (or a specific page's own
 * tighter gate) and the backend are tracked, one GAP id per pattern, in
 * tests/contract/hr-role-matrix.allowlist.json and enforced not to grow
 * silently by tests/contract/hr-role-matrix.contract.test.ts — read that
 * pair before assuming a role belongs here.
 *
 * Deliberately NOT `as const` (unlike FINANCE_ROLES/PROPOSAL_WRITE_ROLES
 * above): the original hr/layout.tsx declaration was a plain `string[]`
 * passed straight into `requireAnyRole(allowed: string[])`, and this
 * extraction keeps that exact type so the call site needs no cast or
 * spread — a smaller diff for a change that must not alter behavior.
 */
export const HR_ROLES = [
  "hr_admin",
  "hr_officer",
  "payroll_officer",
  "payroll_admin",
  "tenant_admin",
  "platform_admin",
  "super_admin",
  "manager",
  "employee",
];
