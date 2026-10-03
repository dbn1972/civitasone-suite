import { HR_ROLES } from "./workRoles";

/**
 * GAP-HR-HOME-01 (redesign/gaps/hr.md) -- the HR hub (hr/page.tsx +
 * HRHubNavigation.tsx) shows all 88 tiles to every role hr/layout.tsx
 * admits, with no tile-level filtering at all. An employee or manager sees
 * Payroll Runs / Vigilance / Disciplinary / Audit Log tiles (among others)
 * that lead straight to that destination's own PermissionDenied wall.
 *
 * This is a *display* filter layered on top of hr/layout.tsx's
 * requireAnyRole(HR_ROLES) gate -- it never widens access and is not itself
 * the security boundary. Every destination's own page/API role check (cited
 * per entry below) remains the real access control, unchanged by this file;
 * hiding a tile here only stops a role that would already be denied at the
 * destination from being offered a dead-end link on the hub.
 *
 * A href with NO entry in HR_TILE_ROLE_OVERRIDES is shown to every role
 * hr/layout.tsx admits (HR_ROLES, imported above) -- that is today's
 * unchanged behaviour, not a security decision. Do not add an entry here
 * unless you can cite a real, already-enforced full-page gate at the
 * destination (or, for the two "acceptance-only" cases below, the specific
 * catalog item that asked for it) -- seeding this map from a guess would
 * risk hiding a tile from a role that legitimately needs it, which is
 * exactly the failure mode GAP-HR-HOME-01 itself warns against.
 *
 * Broader layout-vs-backend role-matrix drift (which roles *should* reach
 * which /hr sub-area at all) is tracked separately and is NOT this file's
 * job to resolve -- see tests/contract/hr-role-matrix.allowlist.json and
 * GAP-HR-SF-09b in the campaign plan.
 */

// hr/layout.tsx's HR_ROLES minus "employee" -- used only for the two
// "acceptance-only" entries below, where GAP-HR-HOME-01's own Acceptance
// list names the tile explicitly but the destination has no full-page gate
// to mirror (see each entry's comment).
const HR_STAFF_ROLES = HR_ROLES.filter((r) => r !== "employee");

export const HR_TILE_ROLE_OVERRIDES: Record<string, readonly string[]> = {
  // --- Mirrors a real, already-enforced full-page PermissionDenied gate
  //     1:1. A role missing here already gets denied at the destination
  //     today; hiding the tile from them is purely descriptive.
  "/hr/advances": ["hr_admin", "finance_admin", "super_admin", "hr_officer", "manager", "officer"], // advances/page.tsx ADVANCE_ROLES
  "/hr/apar": ["hr_admin", "hr_officer", "super_admin", "manager", "employee"], // apar/page.tsx APAR_ROLES
  "/hr/employee-types": ["hr_admin", "super_admin", "admin", "manager", "officer"], // GAP-HR-EMPLOYEE-TYPES-04: mirrors employee-types-routes.ts GET guard (HR_ROLES + manager + officer) 1:1; widening it is the open policy question
  "/hr/interns": ["hr_admin", "hr_officer", "super_admin", "manager"], // interns/page.tsx INTERNS_VIEW_ROLES (GAP-HR-INTERNS-04)
  "/hr/outsourced": ["hr_admin", "hr_officer", "super_admin"], // outsourced/page.tsx OUTSOURCED_ROLES (GAP-HR-OUTSOURCED-01) = outsourced/routes.ts guard
  "/hr/office-locations": ["hr_admin", "super_admin", "admin"], // office-locations/page.tsx OFFICE_LOCATION_ADMIN_ROLES (GAP-HR-LOCATIONS-NEW-02)
  "/hr/icc": ["hr_admin", "super_admin", "icc_member"], // icc/page.tsx ICC_ROLES
  "/hr/id-cards": ["hr_admin", "security_admin", "super_admin"], // id-cards/page.tsx ID_CARDS_ROLES
  "/hr/leave-policies": ["hr_admin", "super_admin", "admin"], // leave-policies/page.tsx LEAVE_POLICY_ADMIN_ROLES
  "/hr/onboarding": ["hr_admin", "hr_officer", "super_admin"], // onboarding/page.tsx ONBOARDING_ROLES
  "/hr/rti": ["hr_admin", "hr_officer", "super_admin"], // rti/page.tsx RTI_ROLES
  "/hr/vigilance": ["hr_admin", "hr_officer", "super_admin"], // vigilance/page.tsx VIGILANCE_ROLES
  "/hr/disciplinary": ["hr_admin", "hr_officer", "super_admin"], // disciplinary/page.tsx DISCIPLINARY_ROLES
  "/hr/work-summary": ["hr_admin", "hr_officer", "manager", "super_admin"], // work-summary/page.tsx WORK_SUMMARY_ROLES
  "/hr/payroll/salary-slips": ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"], // payroll/salary-slips/page.tsx SALARY_ADMIN_ROLES
  "/hr/payroll/pensioners": ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"], // payroll/pensioners/page.tsx PENSIONER_VIEW_ROLES
  "/hr/payroll/structures": ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"], // payroll/structures/page.tsx STRUCTURES_VIEW_ROLES (GAP-HR-SALARY-STRUCTURE-05)

  // --- Acceptance-only (GAP-HR-HOME-01 names both tiles explicitly in its
  //     Acceptance list), but neither destination has a full-page gate to
  //     mirror:
  //     - payroll/page.tsx only gates the "create a run" form behind a
  //       `canAdminister` (PAYROLL_ADMIN_ROLES) check and renders the rest
  //       of the page -- stats, the runs table -- for anyone who reaches it.
  //     - audit-log/page.tsx's real gate (AUDIT_LOG_ROLES = audit_officer,
  //       audit_admin, super_admin, platform_admin) excludes hr_admin and
  //       hr_officer entirely, so mirroring it here would hide the tile
  //       from hr_admin too and fail this same GAP's "hr_admin still sees
  //       all 88 tiles" acceptance line. hr_admin/hr_officer clicking
  //       through to Audit Log today still hit a real PermissionDenied --
  //       that layout-vs-backend role-family mismatch is a separate,
  //       already-catalogued drift (see hr-role-matrix.allowlist.json) left
  //       for GAP-HR-SF-09b, not fixed by this entry.
  //     Both are therefore hidden from "employee" only (HR_STAFF_ROLES) as
  //     a navigation-level call, not a mirror of an existing check.
  "/hr/payroll": HR_STAFF_ROLES,
  "/hr/audit-log": HR_STAFF_ROLES,
};

/** Whether `sessionRoles` should see the hub tile linking to `href`. */
export function hasHrTileAccess(href: string, sessionRoles: readonly string[]): boolean {
  const required = HR_TILE_ROLE_OVERRIDES[href];
  if (!required) return true;
  return sessionRoles.some((r) => required.includes(r));
}
