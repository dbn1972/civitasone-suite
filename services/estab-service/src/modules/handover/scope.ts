import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { resolveActorEmployeeId, HrmsUnavailableError } from "../../shared/hrms-client.js";
import { findActiveOperatorsForEmployee } from "../operators/repo.js";

/**
 * GAP-ESTAB-HANDOVER-02 (owner decision B25): who may move whose files.
 *
 * estab_admin and super_admin are tenant-wide. An estab_division_admin (who holds neither) is
 * limited to the division(s) of their own operator desk(s): the outgoing officer must hold an
 * active desk in one of those divisions. Division model (modules/operators/schema.ts): a desk is
 * `files.estab_file_operator` (employeeId, division, active); an employee may hold desks in
 * several divisions. The caller's employee id comes from the HRMS actor bridge
 * (resolveActorEmployeeId), because ctx.actorId is the login subject, not an employee id.
 *
 * A division admin with no active desk (not enrolled as an operator, or no linked employee
 * record) gets 403 NO_OPERATOR_DESK: authority is derived from the desk, so no desk means none.
 */
export const TENANT_WIDE_HANDOVER_ROLES = ["estab_admin", "super_admin"] as const;

export function isTenantWideHandoverCaller(roles: readonly string[]): boolean {
  return TENANT_WIDE_HANDOVER_ROLES.some((r) => roles.includes(r));
}

/** The divisions the caller administers through their own active desks (empty = none). */
export async function callerDivisions(ctx: RequestContext): Promise<string[]> {
  let employeeId: string | null;
  try {
    employeeId = await resolveActorEmployeeId(ctx.tenantId, ctx.actorId);
  } catch (err) {
    if (err instanceof HrmsUnavailableError) {
      // Fails closed: "cannot tell which division you administer" is never "allow".
      throw new HttpError(503, "HRMS_UNAVAILABLE", "cannot confirm your division right now; try again shortly");
    }
    throw err;
  }
  if (!employeeId) return [];
  const desks = await findActiveOperatorsForEmployee(ctx.tenantId, employeeId);
  return [...new Set(desks.map((d) => d.division))];
}

/**
 * Throws unless the caller may take files from `fromOfficerId`. No-op for tenant-wide callers.
 * `fromOfficerId` is an hrms employee id (the operators directory's id space).
 */
export async function assertMayHandOverFrom(ctx: RequestContext, fromOfficerId: string): Promise<void> {
  if (isTenantWideHandoverCaller(ctx.roles)) return;
  const mine = await callerDivisions(ctx);
  if (mine.length === 0) {
    throw new HttpError(403, "NO_OPERATOR_DESK", "a division admin acts only through an active operator desk; you have none, so no division is in your scope");
  }
  const fromDesks = await findActiveOperatorsForEmployee(ctx.tenantId, fromOfficerId);
  if (!fromDesks.some((d) => mine.includes(d.division))) {
    throw new HttpError(403, "OUTSIDE_DIVISION_SCOPE", "that officer is not on an active desk in a division you administer");
  }
}
