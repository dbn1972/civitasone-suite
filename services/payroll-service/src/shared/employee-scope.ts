/**
 * Self-service employee scoping for payroll routes.
 *
 * ctx.actorId (the JWT subject / login user id) is a DIFFERENT id space from
 * payroll's employee_id columns, which hold hrms_employees.id. Comparing the
 * two directly is never right: it 403s an employee asking for their OWN
 * record, or scopes them to an id no payroll row carries (empty results).
 * Ownership is therefore decided against the caller's resolved hrms employee
 * id (hrms-client.ts resolveActorEmployeeId), failing CLOSED.
 *
 * Who counts as "staff" (may act on any employee) is decided per ROUTE from
 * that route's own allowed staff roles -- never from a global privileged
 * list. A global list that includes e.g. finance_officer would let a
 * finance_officer+employee user read every employee's data on a route that
 * does not admit finance_officer at all (b3 review, HIGH; PR #1764).
 */
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "./context.js";
import { resolveActorEmployeeId, HrmsUnavailableError } from "./hrms-client.js";

/**
 * The caller's own hrms_employees.id. Fails CLOSED: an unreachable HRMS is
 * 502, an actor with no linked employee record is 403.
 */
export async function requireOwnEmployeeId(ctx: RequestContext): Promise<string> {
  let own: string | null;
  try {
    own = await resolveActorEmployeeId(ctx.tenantId, ctx.actorId);
  } catch (err) {
    if (err instanceof HrmsUnavailableError) {
      throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot resolve caller's employee record: HRMS identity source unreachable");
    }
    throw err;
  }
  if (!own) throw new HttpError(403, "FORBIDDEN", "no employee record is linked to this user");
  return own;
}

/** A route's allowed roles minus the self-service `employee` role. */
export function staffRolesOf(routeRoles: readonly string[]): string[] {
  return routeRoles.filter((r) => r !== "employee");
}

/**
 * True when the caller may act on any employee on this route: an internal
 * service account, or a holder of one of the route's own `staffRoles`.
 */
export function isRouteStaff(ctx: RequestContext, staffRoles: readonly string[]): boolean {
  return ctx.actorType === "service_account" || staffRoles.some((r) => ctx.roles.includes(r));
}

/**
 * Effective employeeId for a single-employee read/write. Staff (per
 * `staffRoles`) pass the requested id through (400 if missing). Every other
 * caller is pinned to their OWN resolved employee id; naming anyone else is
 * 403.
 */
export async function scopeEmployeeId(
  ctx: RequestContext,
  requested: string | undefined,
  staffRoles: readonly string[],
): Promise<string> {
  if (isRouteStaff(ctx, staffRoles)) {
    if (!requested) throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required");
    return requested;
  }
  const own = await requireOwnEmployeeId(ctx);
  if (requested && requested !== own) {
    throw new HttpError(403, "FORBIDDEN", "employees may only access their own records");
  }
  return own;
}
