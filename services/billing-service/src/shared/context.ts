import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { requirePermission } from "@civitasone/auth/permissions";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  /** Extra machine-readable fields merged into the error body (e.g. nextAllowedAt on a 429). */
  public extra: Record<string, unknown> | undefined;
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
  withExtra(extra: Record<string, unknown>): this {
    this.extra = extra;
    return this;
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

export function requireSuperAdmin(ctx: RequestContext): void {
  requireRole(ctx, ["super_admin", "platform_admin"]);
}

export const TENANT_ADMIN_ROLES = ["tenant_admin", "super_admin", "platform_admin"] as const;

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
