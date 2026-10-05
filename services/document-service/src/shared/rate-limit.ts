/**
 * Rate limiting for document-service (the repo's @civitasone/rate-limit plugin, @fastify/rate-limit underneath).
 *
 * Keyed per tenant + AUTHENTICATED USER (never just the IP), so one user's burst cannot throttle a colleague and a tenant
 * cannot hide behind a shared address. Limits per minute, overridable by env:
 *   DOCUMENT_RATE_LIMIT_MAX            default 600  all routes (per user + tenant)
 *   DOCUMENT_DOWNLOAD_RATE_LIMIT       default 60   GET bulk-scan filed-document download (presigned URL + audit event each)
 *   DOCUMENT_PAGE_IMAGE_RATE_LIMIT     default 300  GET bulk-scan page image (a viewer pages through many images)
 *   DOCUMENT_RATE_LIMIT_ALLOWLIST      comma separated IPs that skip limiting (default: NONE, not even loopback: every request arrives from the gateway on 127.0.0.1, so a loopback exemption would disable limiting entirely)
 * A 429 carries the standard body (error TOO_MANY_REQUESTS, retryAfter) and a Retry-After header.
 */
import type { FastifyRequest } from "fastify";
import { resolveContext } from "./context.js";

const intEnv = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : dflt;
};

export const globalRateLimit = (): number => intEnv("DOCUMENT_RATE_LIMIT_MAX", 600);
export const downloadRateLimit = (): number => intEnv("DOCUMENT_DOWNLOAD_RATE_LIMIT", 60);
export const pageImageRateLimit = (): number => intEnv("DOCUMENT_PAGE_IMAGE_RATE_LIMIT", 300);

export function rateLimitAllowList(): string[] {
  const v = process.env.DOCUMENT_RATE_LIMIT_ALLOWLIST;
  return v === undefined ? [] : v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** tenant + user from the verified token; an unauthenticated request (rejected by auth anyway) falls back to the IP. */
export function rateLimitKey(req: FastifyRequest): string {
  try {
    const c = resolveContext(req);
    return `${c.tenantId}:${c.actorId}`;
  } catch {
    return `ip:${req.ip}`;
  }
}

/** Route-level override for @fastify/rate-limit (same key generator as the global registration). */
export const routeRateLimit = (max: number): { config: { rateLimit: { max: number; timeWindow: string; keyGenerator: (req: FastifyRequest) => string } } } =>
  ({ config: { rateLimit: { max, timeWindow: "1 minute", keyGenerator: rateLimitKey } } });
