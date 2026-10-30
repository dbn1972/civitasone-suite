import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole, verifyJwt, toRequestContext, type CivitasJwtPayload } from "@civitasone/auth";
import { isSessionDenylisted } from "@civitasone/auth/denylist";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A verified bearer token: same tenant + revoked-session (SEC-006) checks authPlugin applies. */
async function fromVerifiedToken(req: FastifyRequest, payload: CivitasJwtPayload, correlationId: string): Promise<RequestContext> {
  const ctx = requireTenant(toRequestContext(payload, correlationId));
  if (ctx.sessionId && (await isSessionDenylisted(ctx.sessionId, req.log))) {
    throw new HttpError(401, "UNAUTHENTICATED", "session has been revoked");
  }
  return ctx;
}

function requireTenant(ctx: RequestContext): RequestContext {
  if (!ctx.tenantId || !UUID_RE.test(ctx.tenantId)) {
    throw new HttpError(401, "UNAUTHENTICATED", "missing or malformed tenant context");
  }
  return ctx;
}

/**
 * Resolve the authenticated request context for gateway-native routes
 * (the catalogue). The gateway does not register authPlugin globally, so
 * req.ctx is never populated here.
 *
 * UAT W8-C: this used to call ONLY resolveServiceContext(), whose bearer path is
 * the HS256 dev/test shared secret. On an RS256 (Keycloak) deployment, which is
 * what UAT and production run, that path never matches, so every catalogue
 * route answered 401 "invalid or expired token" to every real user token. The
 * order now is:
 *   1. req.jwtPayload: set by jwtEdgeVerify ONLY from a cryptographically
 *      verified token (never in audit mode after a failed verify);
 *   2. resolveServiceContext(): internal x-service-secret path and the HS256
 *      dev/test path, unchanged;
 *   3. verifyJwt() on the bearer: the same RS256/JWKS verification authPlugin
 *      runs in every other service (covers GATEWAY_JWT_EDGE_VERIFY=off/audit).
 * The tenant always comes from the verified token, never from a header.
 */
export async function resolveContext(req: FastifyRequest): Promise<RequestContext> {
  const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? req.id;
  const verified = (req as FastifyRequest & { jwtPayload?: CivitasJwtPayload }).jwtPayload;
  if (verified) return fromVerifiedToken(req, verified, correlationId);
  try {
    return requireTenant(resolveServiceContext(req));
  } catch (err) {
    if (!(err instanceof AuthContextError)) throw err;
    const auth = req.headers.authorization;
    if (err.status === 401 && typeof auth === "string" && auth.startsWith("Bearer ")) {
      let payload: CivitasJwtPayload | null = null;
      try {
        payload = await verifyJwt(auth.slice(7));
      } catch {
        payload = null;
      }
      if (payload) return fromVerifiedToken(req, payload, correlationId);
    }
    throw new HttpError(err.status, err.code, err.message);
  }
}

export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", `requires one of: ${roles.join(", ")}`);
  }
}
