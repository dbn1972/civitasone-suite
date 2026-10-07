import type { FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { resolveEmployeeForActor } from "../modules/employee/actor-link.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

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
  requested: string,
): Promise<string | null> {
  const isPrivileged = [...HR_ROLES, "manager"].some((r) => ctx.roles.includes(r));
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
