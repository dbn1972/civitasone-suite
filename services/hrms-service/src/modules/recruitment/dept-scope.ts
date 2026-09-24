import type { FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { resolveEmployeeForActor, extractActorEmail } from "../employee/actor-link.js";

/** Roles that see the full tenant's recruitment data, unscoped by department. */
export const TENANT_WIDE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export interface DeptScope {
  /** true: caller holds an HR/admin role -- sees everything tenant-wide, as before this fix. */
  tenantWide: boolean;
  /** The caller's own department, when tenantWide is false. Null when scoping
   *  applies but no department could be resolved for this caller (fails
   *  CLOSED -- they see/touch nothing outside their own creations, never a
   *  fallback to unscoped tenant-wide access). */
  departmentId: string | null;
}

/**
 * HIGH finding: zero department-scoped authorization existed anywhere in the
 * recruitment module -- a caller whose only qualifying role was "manager" or
 * "hiring_manager" (gated tenant-wide purely by holding that role name)
 * could view/edit every OTHER department's requisitions/interviews, not just
 * their own. HR/admin roles (TENANT_WIDE_ROLES) are unaffected -- mirrors
 * the "hr_admin who ALSO holds manager is unaffected" precedent in
 * manager-employee-read-scope-real-db.test.ts, i.e. holding ANY tenant-wide
 * role exempts a caller even if they also hold manager/hiring_manager.
 *
 * Reuses resolveEmployeeForActor (employee/actor-link.ts) -- the same
 * userRef-then-email-fallback resolution every other manager-scope check in
 * this codebase (leave, employee directory, appraisals, ...) already uses --
 * rather than inventing a second way to find "the caller's own employee
 * row". A manager/hiring_manager caller whose hrms_employees link can't be
 * resolved at all gets departmentId: null, which every call site below
 * treats as "matches nothing" (fail closed), matching that same precedent's
 * "must see NOTHING, never fall back to unscoped access" rule.
 */
export async function resolveDeptScope(req: FastifyRequest, ctx: RequestContext): Promise<DeptScope> {
  if (ctx.roles.some((r: string) => TENANT_WIDE_ROLES.includes(r))) return { tenantWide: true, departmentId: null };
  const emp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId, extractActorEmail(req));
  return { tenantWide: false, departmentId: emp?.departmentId ?? null };
}
