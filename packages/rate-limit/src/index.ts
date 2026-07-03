import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export interface RateLimitConfig {
  max?: number;          // default 100 requests per window
  timeWindow?: string;   // default "1 minute"
  allowList?: string[];  // IPs to skip (internal services)
}

export async function registerRateLimit(app: FastifyInstance, config: RateLimitConfig = {}): Promise<void> {
  await app.register(rateLimit, {
    max: config.max ?? 100,
    timeWindow: config.timeWindow ?? "1 minute",
    allowList: config.allowList ?? ["127.0.0.1", "::1"],
    keyGenerator: (req) => {
      // Use tenant ID + IP for per-tenant limiting
      const tenantId = (req as any).tenantId ?? req.ip;
      return `${tenantId}:${req.ip}`;
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });
}
