import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { requirePermission } from "@civitasone/auth/permissions";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    return resolveServiceContext(req);
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", `requires one of: ${roles.join(", ")}`);
  }
}

export async function requirePermissionKey(ctx: RequestContext, permissionKey: string): Promise<void> {
  try {
    await requirePermission(ctx, permissionKey);
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/** Roles that may read/act on ANY employee's payroll/tax data (cross-employee). */
const PRIVILEGED_PAYROLL_ROLES = [
  "payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer",
];

/**
 * True when the caller is acting purely as an `employee` (self-service) — i.e.
 * holds the `employee` role but none of the privileged payroll/admin/officer
 * roles, and is a real user (not an internal service account). Such a caller
 * must be confined to their OWN employee record.
 */
export function isSelfServiceEmployee(ctx: RequestContext): boolean {
  if (ctx.actorType === "service_account") return false;
  const privileged = PRIVILEGED_PAYROLL_ROLES.some((r) => ctx.roles.includes(r));
  return !privileged && ctx.roles.includes("employee");
}
