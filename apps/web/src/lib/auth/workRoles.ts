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
 * GAP-FINANCE-OPENING-BALANCES-04: roles finance-service lets POST
 * /v1/finance/opening-balances (masters/fy-routes.ts WRITER_ROLES). Other
 * FINANCE_ROLES members (finance_officer, audit_officer, ...) can read the
 * balances but get a 403 only AFTER confirming, so the entry form is hidden
 * for them. Mirrors that constant exactly -- keep in sync.
 */
export const OPENING_BALANCE_WRITE_ROLES = ["finance_admin", "super_admin"] as const;

/**
 * GAP-FINANCE-PAYMENTS-04: roles finance-service lets create a payment
 * (POST /v1/finance/payments/eft) and trigger the PFMS sync action
 * (payments/routes.ts FINANCE_ROLES). audit_officer / budget_officer /
 * procurement_officer / accounts_officer can open the page but would 403 after
 * typing a reason, so the buttons are hidden for them. Mirrors that constant.
 */
export const PAYMENT_WRITE_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

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
 *
 * GAP-HR-SF-09b widened this list by four roles, resolving the largest
 * cluster of tests/contract/hr-role-matrix.allowlist.json's drift entries
 * (GAP-HR-SF09A-001/002/003/011/012/014, ~149 of the ~186 tracked drifts).
 * This is the SAME reciprocal-widening move FINANCE_ROLES's own doc comment
 * above already describes making in the mirror-image direction ("a
 * payroll_admin hitting the PFMS salary-bill bridge"); this side of that
 * exchange had never been made:
 *
 *  - "finance_officer", "finance_admin": already named directly in >120
 *    hrms-service/payroll-service routes this layout gates (gpf, nps,
 *    pension, cpf, pay-matrix, payroll-config, apprentice-stipend,
 *    consultant-invoice, contractor-bill, contracts, loans, salary-slips) --
 *    HR-hosted but finance-owned statutory/benefit/vendor-payment modules.
 *    Confirmed intended (not just backend-reachable-by-accident) by
 *    redesign/gaps/hr.md GAP-HR-ADVANCES-04 and GAP-HR-LOANS-04, both of
 *    which independently arrive at "add finance_admin ... to HR_ROLES" as
 *    the fix once finance access is confirmed intentional. Every route
 *    these two roles reach still enforces its OWN `requireRole(ctx, ...)`
 *    check first -- this list only stops the layout from turning them away
 *    before that real check ever runs; it grants no new backend access.
 *  - "admin": bare "admin" was already admitted by FOUR of this same /hr
 *    tree's own page-level gates (departments/new, designations/new,
 *    leave-policies, locations/new -- see hrTileAccess.ts) and by several
 *    backend files, but rejected at this outer layout gate first -- the
 *    single most internally-inconsistent finding in the SF-09a sweep
 *    (GAP-HR-SF09A-002): the web layer disagreed with itself.
 *  - "officer": a real, if legacy, platform role -- confirmed via
 *    services/policy-service/src/modules/roles/keycloak-catalog.ts's own
 *    "7 role names the real Keycloak realm actually issues" list, and via
 *    apps/web/src/app/api/auth/dev-login/route.ts's `officer` persona --
 *    used consistently by 4 hrms-service files (employee-types-routes.ts,
 *    engagement-policy.ts, loans-routes.ts, face-verification/routes.ts)
 *    for years, but never reachable through /hr at all (GAP-HR-SF09A-003/
 *    011/014; redesign/gaps/hr.md's own EMPLOYEE-TYPES-04 speculates this
 *    role "cannot be verified" -- the keycloak catalog resolves that doubt).
 *
 * NOTE for reviewers: this is the one entry in GAP-HR-SF-09b's fix set that
 * genuinely widens access at the single outermost gate for the entire /hr,
 * /hr/payroll and /hr/recruitment tree, rather than correcting an
 * already-narrow page-level gate -- flagged for explicit sign-off per the
 * campaign's security-change convention, even though every one of these
 * four roles already had real, intentional backend access this list was
 * simply failing to let them reach. Deliberately NOT adding here (left
 * allowlisted, see hr-role-matrix.allowlist.json): "dept_head" (also a real
 * keycloak-catalog role, but zero existing web-side precedent anywhere in
 * apps/web, unlike the four above -- a first-time grant, not a reconciled
 * drift; needs its own product decision) and the ad hoc recruitment/audit/
 * device-trust panel roles (hiring_manager, audit_admin, it_admin,
 * interviewer, vigilance_officer), none of which any web page references.
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
  "admin",
  "officer",
  "finance_officer",
  "finance_admin",
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

/**
 * GAP-PAYROLL-INCOME-TAX-02 / GAP-PAYROLL-FORM16-06: hr/layout.tsx's broad
 * HR_ROLES admits "manager" and "employee" to every /hr/payroll/* URL (by
 * design — see HR_ROLES's own doc comment), but income-tax and Form 16 are
 * individual salary/tax detail screens that need their own tighter,
 * page-level gate, the same way hr/payroll/page.tsx already has its own
 * local `PAYROLL_ADMIN_ROLES` check.
 *
 * Re-derived from payroll-service's actual route guards rather than
 * assumed: this exact 6-role list is `READER_ROLES` in
 * services/payroll-service/src/modules/tax/routes.ts (income-tax,
 * tax/computation, tax/form16, tax-declarations) AND in
 * modules/statutory-returns/routes.ts (form12ba) AND in
 * modules/form16-pdf/routes.ts (the single-employee Form 16 PDF route) —
 * three independent backend files agreeing on the identical list. Critically,
 * "manager" is NOT in any of them (a manager gets a flat 403), and "employee"
 * is scoped server-side to their own record (`enforceEmployeeOwnership` /
 * `isSelfServiceEmployee`) regardless of what id the request names — so an
 * `employee` caller reaching one of these pages only ever gets back their own
 * row, never a tenant-wide list. This constant exists so the WEB page stops
 * fetching (and a `manager` session stops seeing a confusing 403/empty page)
 * before that backend call ever runs, not because the backend itself was
 * leaking cross-employee data — it wasn't.
 */
export const PAYROLL_TAX_READER_ROLES = [
  "payroll_admin",
  "payroll_officer",
  "super_admin",
  "hr_admin",
  "finance_officer",
  "employee",
];

/**
 * GAP-PAYROLL-STATUTORY-PERQUISITE-04 / GAP-PAYROLL-STATUTORY-NPS-03: the
 * statutory PF/ESI/TDS/Gratuity/GPF/NPS *report* endpoints
 * (services/payroll-service/src/modules/statutory/routes.ts's own
 * `READER_ROLES`) are tenant-wide listings with no self-service scoping at
 * all (unlike PAYROLL_TAX_READER_ROLES's tax/form12ba endpoints) — "employee"
 * is deliberately absent here, matching the backend exactly, not widened to
 * match the broader constant above. Perquisite's own form12ba GET does
 * support a self-scoped "employee" caller (see PAYROLL_TAX_READER_ROLES),
 * but that page's UI is an admin lookup-by-arbitrary-employee-id tool plus an
 * admin-only add-component form (statutory-returns/routes.ts's
 * `STATUTORY_ROLES`, which is narrower still — payroll_admin/payroll_officer/
 * super_admin only), so gating the whole page at this privileged tier avoids
 * inviting self-service use of a tool that isn't built for it.
 */
export const PAYROLL_STATUTORY_ADMIN_ROLES = [
  "payroll_admin",
  "payroll_officer",
  "super_admin",
  "hr_admin",
  "finance_officer",
];

/**
 * GAP-ASSETS-DETAIL-02: roles asset-service admits on its asset mutation
 * routes (transfer, dispose, request-disposal, barcode tag, create). Mirrors
 * the ASSET_ROLES constant in the asset-service package's lifecycle and
 * register route modules exactly -- keep in sync if that list changes. The
 * client gate is UX only; the service stays authoritative (403).
 */
export const ASSET_WRITE_ROLES = ["asset_manager", "asset_admin", "super_admin"] as const;

export function canWriteAssets(roles: readonly string[]): boolean {
  return roles.some((r) => (ASSET_WRITE_ROLES as readonly string[]).includes(r));
}
