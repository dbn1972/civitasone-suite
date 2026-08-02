import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  /**
   * Optional per-field detail for the `{ error: { code, message, details } }`
   * envelope. Left undefined by every pre-existing call site, so the older
   * modules' flat error bodies are unchanged.
   */
  public details: Record<string, string> | undefined;

  constructor(public status: number, public code: string, message: string) {
    super(message);
  }

  /** Attach field-level validation detail and return `this` (fluent throw). */
  withDetails(details: Record<string, string>): this {
    this.details = details;
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
