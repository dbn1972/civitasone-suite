import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { requirePermission } from "@civitasone/auth/permissions";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  // `details`: optional structured extra fields merged into the error JSON
  // body by a route's errorHandler (see recruitment/routes.ts) alongside
  // code/message/correlationId — e.g. a DUPLICATE_APPLICATION error handing
  // back the real, already-existing resource's id so the caller isn't left
  // with nothing to reference. Optional and additive: every existing 3-arg
  // `new HttpError(status, code, message)` call site is unaffected.
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
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
