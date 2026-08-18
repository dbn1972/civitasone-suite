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

export async function registerRateLimit(app: FastifyInstance, config: RateLimitConfig = {}): Promise<void> {
  await app.register(rateLimit, {
    max: config.max ?? 100,
    timeWindow: config.timeWindow ?? "1 minute",
    allowList: config.allowList ?? ["127.0.0.1", "::1"],
    keyGenerator: config.keyGenerator ?? ((req) => {
      // Use tenant ID + IP for per-tenant limiting
      const tenantId = (req as any).tenantId ?? req.ip;
      return `${tenantId}:${req.ip}`;
    }),
    ...(config.skip ? { skip: config.skip } : {}),
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });
}
