/**
 * Request context resolution, role checking, and HttpError definitions.
 * Extracts tenantId and userId from JWT via @civitasone/auth, enforces RLS context.
 */
import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve tenant context from the incoming request JWT.
 * Validates that tenantId is a well-formed UUID. Throws HttpError on failure.
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

/**
 * Enforce RBAC: assert the caller holds at least one of the required roles.
 * Throws 403 FORBIDDEN otherwise.
 */
export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", `requires one of: ${roles.join(", ")}`);
  }
}
