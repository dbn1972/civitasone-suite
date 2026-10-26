import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface RateLimitConfig {
  max?: number;          // default 100 requests per window
  timeWindow?: string;   // default "1 minute"
  allowList?: string[];  // IPs to skip (internal services)
  /** Override the default tenant+IP key with a custom key function (e.g. actorId-based). */
  keyGenerator?: (req: FastifyRequest) => string;
  /** Return true to skip rate limiting for this request (e.g. health/metrics paths). */
  skip?: (req: FastifyRequest) => boolean;
}

/**
 * Default bucket key: the VERIFIED tenant from req.ctx (set by authPlugin from the
 * validated token) plus the IP. Never reads an x-tenant-id header (client-forgeable).
 * A missing ctx, or the empty tenantId that public paths carry, is treated as absent
 * and falls back to a per-IP bucket. The auth plugin must be registered BEFORE
 * registerRateLimit so ctx is populated when the limiter's onRequest hook runs.
 */
export function defaultKey(req: FastifyRequest): string {
  const tenantId = (req as { ctx?: { tenantId?: string } | null }).ctx?.tenantId;
  return tenantId ? `tenant:${tenantId}:${req.ip}` : `ip:${req.ip}`;
}

export async function registerRateLimit(app: FastifyInstance, config: RateLimitConfig = {}): Promise<void> {
  const allowed = new Set(config.allowList ?? ["127.0.0.1", "::1"]);
  await app.register(rateLimit, {
    max: config.max ?? 100,
    timeWindow: config.timeWindow ?? "1 minute",
    // @fastify/rate-limit compares a static allowList with the *generated key*
    // (tenant:ip), never the bare IP, so a string[] could not match. Use a
    // function over req.ip, which already honours the app's trustProxy setting.
    allowList: (req: FastifyRequest) => allowed.has(req.ip),
    keyGenerator: config.keyGenerator ?? defaultKey,
    ...(config.skip ? { skip: config.skip } : {}),
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });
}
