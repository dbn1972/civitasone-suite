import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    return resolveServiceContext(req);
  } catch (err) {
    if (err instanceof AuthContextError)
      throw new HttpError(err.status, err.code, err.message);
    throw err;
  }
}

/**
 * requireRole — every route is staff-only. `citizen` is NEVER in a role list
 * here (house rule 9: staff-only routes exclude citizen). The tenant,
 * organisation and jurisdiction are derived from the server context
 * (RequestContext), never from client ids.
 */
export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles))
    throw new HttpError(403, "FORBIDDEN", `requires one of: ${roles.join(", ")}`);
}
