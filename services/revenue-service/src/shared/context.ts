import type { FastifyRequest } from "fastify";

export interface RequestContext {
  actorId: string;
  tenantId: string;
  roles: string[];
  sessionId: string;
  correlationId: string;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function resolveContext(req: FastifyRequest): RequestContext {
  const user = (req as any).user;
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "missing authentication");
  return {
    actorId: user.sub,
    tenantId: user.tid,
    roles: user.roles ?? [],
    sessionId: user.sid ?? "",
    correlationId: (req.headers["x-correlation-id"] as string) ?? req.id,
  };
}

export function requireRole(ctx: RequestContext, allowed: string[]): void {
  const has = ctx.roles.some((r) => allowed.includes(r));
  if (!has) throw new HttpError(403, "FORBIDDEN", "insufficient role");
}
