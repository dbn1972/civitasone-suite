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
  // GAP-HR-ICC-06: a nominated ICC member holding ONLY icc_member (no HR
  // role) was redirected to /dashboard by this layout before /hr/icc's own
  // (already-correct) page/API gate ever ran. hrTileAccess.ts's
  // HR_TILE_ROLE_OVERRIDES already maps "/hr/icc" to icc_member (GAP-HR-
  // HOME-01), so the hub already filters correctly once this layout admits
  // the role at all.
  "icc_member",
];

/**
 * GAP-HR-LEAVE-POLICIES-01/02: roles allowed to administer leave policy
 * rules (the /hr/leave-policies page and its backend, policy-admin-routes.ts's
 * HR_ADMIN_ROLES — keep both in sync).
 *
 * Two corrections from the gap catalogue's first-pass list
 * (["hr_admin", "super_admin", "admin"]), re-derived from the actual role
 * catalogue rather than assumed:
 *  - Dropped the bare "admin" role: it is not in Keycloak's realm roles
 *    (infra/keycloak/civitasone-realm.json), not in HR_ROLES/
 *    EMPLOYEE_ADMIN_ROLES above, and packages/auth's toRequestContext reads
 *    `roles` straight off the verified JWT payload — "admin" is simply never
 *    issued to any principal in this system (the one other place it
 *    appears, FINANCE_ROLES above, is an unrelated module's role list).
 *  - Added tenant_admin/platform_admin: both already clear hr/layout.tsx's
 *    HR_ROLES (so they reach this page today) but were denied by the old,
 *    narrower list here and by the backend — the exact same dead-end class
 *    of bug GAP-HR-LEAVE-POLICIES-01 reports for hr_officer, just for two
 *    different roles ("Reverse mismatch too" in that gap's evidence).
 *    Unlike hr_officer (a lower/narrower HR tier — widening leave-entitlement
 *    authority to it is a policy call needing HR sign-off, NOT done here),
 *    tenant_admin/platform_admin are already-trusted, tenant-wide
 *    administrative roles elsewhere in this app, so closing their dead end
 *    is a safe, non-widening fix.
 *  - hr_officer is deliberately NOT added: leave-policies changes affect
 *    payroll/LOP calculation, and the catalogue's own risk note says that
 *    widening needs explicit HR sign-off. GAP-HR-LEAVE-POLICIES-01 instead
 *    stops hr_officer's dead-end by hiding the /hr/leave "Policies" link for
 *    roles that can't use it (see leave/page.tsx's canManagePolicies).
 */
export const LEAVE_POLICY_ADMIN_ROLES = ["hr_admin", "super_admin", "tenant_admin", "platform_admin"];
