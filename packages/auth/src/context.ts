import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { verifyToken, toRequestContext } from "./index.js";
import type { RequestContext } from "@civitasone/types";

/** Thrown when route context cannot be resolved (map to service HttpError). */
export class AuthContextError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Resolve RequestContext for route handlers.
 * Prefers req.ctx set by authPlugin (Keycloak RS256). Falls back to HS256 test tokens.
 */
export function resolveServiceContext(req: FastifyRequest): RequestContext {
  const idempotencyKey = (req.headers["x-idempotency-key"] as string | undefined) || undefined;
  const base = resolveServiceContextInner(req);
  return idempotencyKey ? { ...base, idempotencyKey } : base;
}

function resolveServiceContextInner(req: FastifyRequest): RequestContext {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  const ctx = (req as FastifyRequest & { ctx?: RequestContext }).ctx;

  const tenantHeader = req.headers["x-tenant-id"] as string | undefined;
  if (req.headers["x-internal"] === "1" && tenantHeader) {
    // Defense-in-depth: require INTERNAL_SERVICE_SECRET even in the fallback resolver.
    // The authPlugin hook already enforces this, but we re-check here so any service
    // that accidentally omits the plugin still rejects unauthenticated x-internal calls.
    const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
    if (
      typeof serviceSecret !== "string" ||
      serviceSecret.length === 0 ||
      !constantTimeEqual(req.headers["x-service-secret"] as string | undefined, serviceSecret)
    ) {
      throw new AuthContextError(401, "UNAUTHENTICATED", "x-internal requires valid service secret");
    }
    return {
      tenantId: tenantHeader,
      actorId: "00000000-0000-0000-0000-000000000099",
      actorType: "service_account",
      roles: ["super_admin", "hr_admin", "payroll_admin", "finance_admin"],
      correlationId,
      sessionId: "",
    };
  }

  if (ctx && ctx.actorId !== "system" && ctx.actorId !== "anonymous") {
    return { ...ctx, correlationId };
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throw new AuthContextError(401, "UNAUTHENTICATED", "missing bearer token");
  }

  // SEC-1: the HS256 shared-secret fallback is a TEST/DEV convenience only.
  // It must NEVER run in production, even if JWT_SECRET happens to be set.
  const isProduction = process.env.NODE_ENV === "production";
  const useHs256 =
    !isProduction &&
    (process.env.JWT_ALGORITHM === "HS256" ||
      process.env.NODE_ENV === "test" ||
      Boolean(process.env.JWT_SECRET));

  if (useHs256 && process.env.JWT_SECRET) {
    try {
      const payload = verifyToken(auth.slice(7), process.env.JWT_SECRET);
      return toRequestContext(
        payload,
        correlationId,
        (req.headers["x-tenant-id"] as string | undefined),
      );
    } catch {
      throw new AuthContextError(401, "UNAUTHENTICATED", "invalid or expired token");
    }
  }

  throw new AuthContextError(401, "UNAUTHENTICATED", "invalid or expired token");
}

/** Constant-time string comparison to prevent timing attacks on secrets. */
function constantTimeEqual(a: string | undefined | null, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Compare against b to avoid short-circuiting, but always return false
    timingSafeEqual(bBuf, bBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
