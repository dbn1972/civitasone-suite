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

/**
 * SEC-016: gate for routes documented as internal (service-to-service) only.
 *
 * An `INTERNAL_ROLES`-style array's `"service_account"` entry can never
 * match here: that string is never present in `ctx.roles` for any caller —
 * only a genuine `x-internal` + service-secret call sets it, and only on
 * `ctx.actorType` (see packages/auth/src/context.ts's internal-caller
 * branch). Checking the roles array alone therefore silently degrades these
 * routes' real gate to whatever human-holdable role happens to also be in
 * the array (typically `super_admin`, because that's what the internal path
 * stamps into `ctx.roles`) — exactly the privilege-widening bug SEC-016
 * tracks.
 *
 * This checks the real signal — `ctx.actorType === "service_account"` —
 * directly, OR-ed with any distinct human role still legitimately allowed on
 * the route. Pass an empty array for a route with no such role, i.e. one
 * that really is internal-only with no human exception.
 */
export function requireInternalOrRoles(ctx: RequestContext, roles: string[]): void {
  if (ctx.actorType === "service_account" || hasAnyRole(ctx, roles)) return;
  throw new HttpError(
    403,
    "FORBIDDEN",
    roles.length
      ? `requires a genuine internal service call or one of: ${roles.join(", ")}`
      : "requires a genuine internal service-to-service call",
  );
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
