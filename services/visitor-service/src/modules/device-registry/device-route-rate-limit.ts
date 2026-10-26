/**
 * Per-route @fastify/rate-limit override for the device (deviceAuth) routes.
 *
 * The service-wide limiter is 300 req/min keyed by actorId, falling back to the client IP. Device routes carry
 * no actorId, and several devices at one site normally sit behind ONE NAT address, so a single 300/min per-IP
 * bucket would 429 a site with three or more turnstiles (each is allowed 120/min by deviceAuth).
 *
 * Device routes therefore get their own per-IP bucket (`device-ip:<ip>`, separate from user traffic) with a
 * site-sized ceiling. Fairness PER DEVICE stays with deviceAuth's verified-identity limit (60/120 per device);
 * this bucket only bounds what one address can push at the unauthenticated credential lookup. It is keyed on
 * the IP, never on a client-supplied token/device id, so rotating junk credentials cannot mint fresh buckets.
 *
 * Ceiling: VISITOR_DEVICE_ROUTE_RATE_LIMIT req/min per client IP (default 6000 = 50 turnstiles at full rate).
 */
import type { FastifyRequest } from "fastify";

export const DEFAULT_DEVICE_ROUTE_RATE_LIMIT = 6000;

/** Read per request so the ceiling can be tuned per deployment; invalid/non-positive values fall back to the default. */
export function deviceRouteRateLimitMax(): number {
  const raw = Number(process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DEVICE_ROUTE_RATE_LIMIT;
}

export function deviceRouteRateLimitKey(req: FastifyRequest): string {
  return `device-ip:${req.ip}`;
}

/** Use as `config: { rateLimit: deviceRouteRateLimit }` on every route whose preHandler is deviceAuth. */
export const deviceRouteRateLimit = {
  max: async () => deviceRouteRateLimitMax(),
  timeWindow: "1 minute",
  keyGenerator: deviceRouteRateLimitKey,
};
