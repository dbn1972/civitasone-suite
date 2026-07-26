import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the authenticated request context for gateway-native routes
 * (the catalogue). The gateway does not register authPlugin globally — these
 * first-class routes verify the bearer token themselves via
 * resolveServiceContext (RS256 in prod, HS256 in dev/test).
 */
export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    const ctx = resolveServiceContext(req);
    if (!ctx.tenantId || !UUID_RE.test(ctx.tenantId)) {
      throw new HttpError(401, "UNAUTHENTICATED", "missing or malformed tenant context");
    }
    return ctx;
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
