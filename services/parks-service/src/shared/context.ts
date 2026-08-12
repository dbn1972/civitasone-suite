import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function resolveContext(req: FastifyRequest) {
  try {
    return resolveServiceContext(req);
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

export function requireRole(
  ctx: ReturnType<typeof resolveContext>,
  roles: readonly string[],
): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", "Insufficient role");
  }
}
