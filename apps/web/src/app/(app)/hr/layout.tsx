import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { HR_ROLES } from "@/lib/auth/workRoles";
import { ModuleGate } from "../ModuleGate";

/**
 * Roles permitted to reach any page under /hr (and, since they share this
 * same layout, /hr/payroll and /hr/recruitment too).
 *
 * GAP-HR-SF-09a moved the actual role list to the shared
 * apps/web/src/lib/auth/workRoles.ts (as `HR_ROLES`, alongside
 * FINANCE_ROLES/PROPOSAL_WRITE_ROLES) — this file now only imports it.
 * Zero behavior change: see workRoles.test.ts and this file's own
 * layout.test.tsx for the tests proving the admit/deny behavior is
 * unchanged, and tests/contract/hr-role-matrix.contract.test.ts for the
 * new web-vs-backend role-matrix check this refactor made possible.
 *
 * The list itself used to exclude "employee" and "manager" entirely, on the
 * theory that "regular employees use self-service routes only" (see the
 * previous version of this comment). But there are no separate self-service
 * routes -- the self-service behaviour lives INSIDE this same /hr tree (e.g.
 * hr/leave/apply's getMyProfile() fallback, hr/dashboard's own-profile
 * card, hr/payroll's canAdminister-gated employee view) -- and the
 * hrms-service backend already expects exactly this: most of its route
 * guards are requireRole(ctx, [...HR_ROLES, "employee"]) or
 * [...HR_ROLES, "manager", "employee"] (see services/hrms-service's
 * attendance/apar/appraisals-feedback/assessment/claims/competency/
 * disciplinary-coi/consultant-invoice routes). With the old list, every one
 * of those self-service code paths was unreachable dead code: a plain
 * employee or manager was redirected to /dashboard by this layout before
 * their own page ever ran.
 *
 * Widening this list does not, by itself, expose HR-admin-only screens
 * (payroll runs, disciplinary case management, vigilance, etc.) to a plain
 * employee -- those stay protected by the backend's own per-route role
 * checks (which do NOT include "employee"/"manager"), so an unauthorized
 * fetch from such a page still fails server-side. Individual /hr pages that
 * need to *render differently* for a non-admin (rather than just have their
 * data calls fail) are responsible for their own finer-grained check, the
 * way hr/payroll/page.tsx already does with its own canAdminister look-up.
 */
export default function HrLayout({ children }: { children: ReactNode }) {
  requireAnyRole(HR_ROLES);
  return <ModuleGate moduleKey="hrms">{children}</ModuleGate>;
}
