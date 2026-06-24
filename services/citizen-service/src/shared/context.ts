import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
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

/** Officer-tier roles that may act on behalf of an arbitrary citizenId. */
export const OFFICER_TIER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

/** True if the actor holds any officer-tier role (may specify an arbitrary citizenId). */
export function isOfficer(ctx: RequestContext): boolean {
  return hasAnyRole(ctx, OFFICER_TIER_ROLES);
}

/**
 * P0-3 cross-citizen authz. Resolve the citizenId an actor is allowed to act on.
 *
 * Identity contract: a citizen actor IS identified by ctx.actorId (the JWT sub),
 * and their own citizen profile id equals that actorId (see portal create, which
 * sets profile.id = actorId for citizen-role callers). Therefore:
 *   - citizen role: the effective citizenId is ALWAYS ctx.actorId. A supplied id
 *     that differs from ctx.actorId is rejected (cannot act as another citizen).
 *   - officer-tier role: may target any citizenId; a supplied value is honoured,
 *     else falls back to ctx.actorId.
 */
export function resolveCitizenId(ctx: RequestContext, supplied?: string): string {
  if (isOfficer(ctx)) return supplied ?? ctx.actorId;
  if (supplied !== undefined && supplied !== ctx.actorId) {
    throw new HttpError(403, "FORBIDDEN", "citizens may only act on their own records");
  }
  return ctx.actorId;
}

/**
 * P0-1..P0-5 cross-citizen authz. Assert the actor is permitted to read/mutate a
 * record owned by `ownerCitizenId`. Officers may act on any record; a citizen may
 * only act on a record they own (ownerCitizenId === ctx.actorId). A record whose
 * owner is null/undefined is treated as not-owned-by-the-citizen (denied).
 * Throws HttpError(404) for non-owners so existence is not leaked.
 */
export function assertOwnership(ctx: RequestContext, ownerCitizenId: string | null | undefined): void {
  if (isOfficer(ctx)) return;
  if (ownerCitizenId !== ctx.actorId) {
    throw new HttpError(404, "NOT_FOUND", "not found");
  }
}

export function resolvePublicContext(req: FastifyRequest, tenantId: string): RequestContext {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  return {
    tenantId,
    actorId: "00000000-0000-4000-8000-000000000000",
    actorType: "user" as const,
    correlationId,
    roles: ["public"],
  };
}
