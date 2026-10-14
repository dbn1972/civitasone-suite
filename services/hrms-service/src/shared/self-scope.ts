import type { FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { and, eq } from "drizzle-orm";
import { resolveEmployeeForActor } from "../modules/employee/actor-link.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { scopedRead, sqlClient } from "./db.js";

/** Default HR role set for the helpers below. medical passes its own (it adds finance_officer). */
export const SELF_SCOPE_HR_ROLES: readonly string[] = ["hr_admin", "hr_officer", "super_admin"];
const HR_ROLES = SELF_SCOPE_HR_ROLES;

/**
 * Shared read-side self-scoping, extracted from the identical helper that
 * training/routes.ts already uses for GET /v1/hrms/nominations
 * (resolveOwnEmployeeIdIfBareEmployee). It exists so the learning module's
 * personal-data reads (GET /learning/my-learning, GET /learning/dashboard)
 * can close the same IDOR class with the SAME judgment call rather than a
 * second, divergent implementation.
 *
 * A privileged caller (HR_ROLES or manager) gets the `requested` id passed
 * through unchanged -- this module, like training, has no "manager scoped to
 * direct reports" precedent of its own, so manager pass-through is accepted
 * (documented risk, same as training). A bare "employee" caller is ALWAYS
 * forced onto their OWN linked hrms_employees record (resolveEmployeeForActor:
 * userRef + verified-email fallback), regardless of the employeeId they
 * requested. Returns null when a bare-employee caller has no resolvable
 * employee link -- callers MUST treat that as "nothing to show" (fail CLOSED),
 * never fall through to the requested id.
 */
export async function resolveOwnEmployeeIdIfBareEmployee(
  ctx: RequestContext,
  _req: FastifyRequest,
  requested: string | undefined,
  hrRoles: readonly string[] = HR_ROLES,
): Promise<string | undefined | null> {
  const isPrivileged = [...hrRoles, "manager"].some((r) => ctx.roles.includes(r));
  if (isPrivileged) return requested;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * Write-side self-scoping, extracted from training/routes.ts's
 * resolveOwnEmployeeIdIfNonHr. Any non-HR caller (employee OR manager) is
 * scoped to THEMSELVES regardless of the employeeId submitted -- a manager
 * enrolling an arbitrary colleague would otherwise create a learning record
 * under someone else's identity. HR remains unrestricted (enrol-on-behalf is
 * the intended HR workflow). Returns null when a non-HR caller has no
 * resolvable employee link -- callers MUST reject the write.
 */
export async function resolveOwnEmployeeIdIfNonHr(
  ctx: RequestContext,
  _req: FastifyRequest,
  requested: string,
): Promise<string | null> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) return requested;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * Read target for the learning "my" endpoints (GAP-LEARNING-MY-LEARNING-01,
 * GAP-LEARNING-HOME-01). Resolves the ONE employee id a read is about:
 *   - bare employee: ALWAYS their own linked record, whatever was requested.
 *   - HR / manager: the `requested` id, or -- when none was requested -- their
 *     own linked record (the normal self-service path).
 * Returns null when no employee can be resolved (bare employee or privileged
 * caller without a link and without a requested id): callers MUST treat that
 * as "nothing to show" (fail CLOSED), never fall through to a tenant-wide read.
 */
export async function resolveLearningReadTarget(
  ctx: RequestContext,
  requested: string | undefined,
): Promise<string | null> {
  const isPrivileged = [...HR_ROLES, "manager"].some((r) => ctx.roles.includes(r));
  if (isPrivileged && requested) return requested;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * Leave read-side scope (moved verbatim from leave/routes.ts, SF-16).
 *
 * Resolves the set of employeeIds a NON-HR caller is authorised to see on the
 * leave read routes -- mirrors enforceCcsLeaveRules' ownership shape (self via
 * resolveEmployeeForActor, manager via hrmsEmployees.managerId):
 *   - bare "employee": exactly their own linked id, or [] if unlinked
 *     (fails CLOSED, never tenant-wide).
 *   - "manager" (without HR): `requested`, if it names one of their direct
 *     reports; otherwise every one of their direct reports.
 */
async function resolveNonHrEmployeeScope(
  ctx: RequestContext,
  requested: string | undefined,
): Promise<string[]> {
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) return [];
  if (!ctx.roles.includes("manager")) return [actorEmp.id];
  const reports = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, actorEmp.id))));
  const reportIds = reports.map((r) => r.id);
  if (requested && reportIds.includes(requested)) return [requested];
  return reportIds;
}

/**
 * Full scope resolution for the leave read routes, HR included:
 *   - HR-privileged: `requested` as a single-element array, or `undefined`
 *     (tenant-wide) when no specific target was requested.
 *   - everyone else: a concrete (possibly empty) array -- never `undefined`,
 *     so a non-privileged caller can never fall through to an unscoped query.
 */
export async function resolveLeaveReadScope(
  ctx: RequestContext,
  _req: FastifyRequest,
  requested: string | undefined,
): Promise<string[] | undefined> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return requested ? [requested] : undefined;
  return resolveNonHrEmployeeScope(ctx, requested);
}

/**
 * Attendance self/reports scope (moved verbatim from attendance/routes.ts,
 * SF-16; GAP-HR-SF-16 fold-in SHIFT-REQUESTS-01 / WFH-02 / OVERTIME-03).
 *   - `requested` unchanged (string | undefined) -- HR: unscoped.
 *   - `string[]` -- manager: the concrete [self, ...directReports] set,
 *     narrowed to `[requested]` when requested is inside it, or `[]` (deny)
 *     when it isn't.
 *   - the employee's own id, or `null` (no linked record, fail CLOSED) --
 *     bare "employee".
 */
export async function resolveSelfOrReportsScopedEmployeeId(
  ctx: RequestContext,
  requested: string | undefined,
): Promise<string | string[] | undefined | null> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return requested;
  if (ctx.roles.includes("manager")) {
    const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    if (!actorEmp) return [];
    const reports = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, actorEmp.id))));
    const scope = [actorEmp.id, ...reports.map((r) => r.id)];
    if (requested) return scope.includes(requested) ? [requested] : [];
    return scope;
  }
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * Certifications scope (moved verbatim from gap-features/routes.ts, SF-16):
 * HR unrestricted (null -- no filter), manager scoped to self + direct
 * reports, bare employee scoped to self. Non-HR always gets a concrete
 * (possibly empty) array; empty means "authorized for nothing".
 */
export async function resolveSelfAndReportsScope(ctx: RequestContext): Promise<string[] | null> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return null;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) return [];
  if (!ctx.roles.includes("manager")) return [actorEmp.id];
  const rows = await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    return sql.unsafe(
      `SELECT id FROM employee.hrms_employees WHERE tenant_id = $1 AND manager_id = $2`,
      [ctx.tenantId, actorEmp.id],
    );
  });
  return [actorEmp.id, ...rows.map((r) => r.id as string)];
}

/**
 * Own-record scope for list-dump endpoints with no manager-sees-reports
 * precedent (moved verbatim from gap-features/routes.ts, SF-16): HR
 * unrestricted (undefined), every other caller -- manager included -- scoped
 * to their own hrms_employees.id, or null when unlinked (callers MUST return
 * an empty list).
 */
export async function resolveOwnEmployeeIdUnlessHr(
  ctx: RequestContext,
): Promise<string | null | undefined> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) return undefined;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * Single-target read check (SF-16): may the caller read the record of
 * `targetEmployeeId`?  HR (the supplied hrRoles): yes. Otherwise the caller
 * must have a linked employee record (fail CLOSED when they do not) and the
 * target must be themselves or -- for a manager -- one of their direct reports.
 */
export async function canReadEmployeeRecord(
  ctx: RequestContext,
  targetEmployeeId: string,
  hrRoles: readonly string[] = HR_ROLES,
): Promise<boolean> {
  if (hrRoles.some((r) => ctx.roles.includes(r))) return true;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) return false;
  if (actorEmp.id === targetEmployeeId) return true;
  if (!ctx.roles.includes("manager")) return false;
  const rows = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.id, targetEmployeeId), eq(hrmsEmployees.managerId, actorEmp.id))));
  return rows.length > 0;
}

/**
 * W1 owner decision 2 (2026-10-14): managers see their direct reports only.
 * Returns `undefined` for an HR-privileged caller (tenant-wide), otherwise the
 * concrete set of employee ids the caller may see: [self, ...directReports],
 * or [] when the actor is not linked to an employee (fail CLOSED -- callers
 * must treat an empty set as "nothing", never as "no filter").
 */
export async function resolveManagerScopeIds(
  ctx: RequestContext,
  hrRoles: readonly string[] = HR_ROLES,
): Promise<string[] | undefined> {
  if (hrRoles.some((r) => ctx.roles.includes(r))) return undefined;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) return [];
  const reports = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, actorEmp.id))));
  return [actorEmp.id, ...reports.map((r) => r.id)];
}
