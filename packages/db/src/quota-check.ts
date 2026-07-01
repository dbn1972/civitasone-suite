/**
 * Quota enforcement Fastify plugin.
 *
 * Lightweight per-tenant API rate-limit check using configurable quotas
 * from the tenant_quotas table (served by tenant-service). This complements
 * the gateway's global rate limiter by providing per-tenant configurable limits
 * instead of a hardcoded 200/min.
 *
 * Flow:
 *  1. Read quota from Redis (key: `quota:{tenantId}`, TTL 60s)
 *  2. On miss, fetch from tenant-service: GET /v1/tenant/{tid}/quotas
 *  3. Increment a sliding window counter in Redis for the tenant
 *  4. If the counter exceeds maxApiCallsPerMin, return 429
 *
 * Register after authPlugin so req.ctx is available.
 */
import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";

export interface TenantQuota {
  tenantId: string;
  maxEmployees: number;
  maxFiles: number;
  maxApiCallsPerMin: number;
  maxStorageGb: number;
  maxUsers: number;
}

export interface QuotaCheckStore {
  /** Get cached quota JSON for a tenant, or null on miss. */
  get(key: string): Promise<string | null>;
  /** Set cached quota JSON with TTL in seconds. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Increment a key and return the new value; set TTL on first creation. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export interface QuotaCheckOptions {
  /** Redis-compatible store for quota caching and rate counting. */
  store: QuotaCheckStore;
  /** Base URL of tenant-service (e.g. "http://tenant-service:3002"). */
  tenantServiceUrl: string;
  /** TTL for cached quotas in seconds. Defaults to 60. */
  quotaCacheTtlSeconds?: number;
  /** Rate limit window in seconds. Defaults to 60. */
  windowSeconds?: number;
  /** Paths that skip quota enforcement. */
  skipPaths?: Set<string>;
  /** If true, don't enforce — just log (shadow mode for rollout). */
  shadowMode?: boolean;
}

const DEFAULT_QUOTA: TenantQuota = {
  tenantId: "",
  maxEmployees: 500,
  maxFiles: 10000,
  maxApiCallsPerMin: 200,
  maxStorageGb: 10,
  maxUsers: 100,
};

const SKIP_PATHS = new Set(["/health", "/ready", "/metrics"]);

async function fetchQuotaFromService(
  tenantServiceUrl: string,
  tenantId: string,
): Promise<TenantQuota> {
  const url = `${tenantServiceUrl}/v1/tenant/${tenantId}/quotas`;
  try {
    const res = await fetch(url, {
      headers: {
        "x-internal": "1",
        "x-tenant-id": tenantId,
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ...DEFAULT_QUOTA, tenantId };
    return (await res.json()) as TenantQuota;
  } catch {
    // On failure, fall back to defaults (don't block traffic)
    return { ...DEFAULT_QUOTA, tenantId };
  }
}

const quotaCheckPluginImpl: FastifyPluginAsync<QuotaCheckOptions> = async (fastify, opts) => {
  const {
    store,
    tenantServiceUrl,
    quotaCacheTtlSeconds = 60,
    windowSeconds = 60,
    skipPaths = SKIP_PATHS,
    shadowMode = false,
  } = opts;

  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url?.split("?")[0] ?? "";
    if (skipPaths.has(path)) return;

    // req.ctx populated by authPlugin
    const ctx = (req as unknown as { ctx?: { tenantId?: string } }).ctx;
    const tenantId = ctx?.tenantId;
    if (!tenantId) return; // no tenant context (public / system call)

    // 1. Resolve quota (cache-first)
    const cacheKey = `quota:${tenantId}`;
    let quota: TenantQuota;
    const cached = await store.get(cacheKey);
    if (cached) {
      quota = JSON.parse(cached) as TenantQuota;
    } else {
      quota = await fetchQuotaFromService(tenantServiceUrl, tenantId);
      await store.set(cacheKey, JSON.stringify(quota), quotaCacheTtlSeconds);
    }

    // 2. Sliding window rate check
    const counterKey = `quota_rate:${tenantId}`;
    const current = await store.incr(counterKey, windowSeconds);

    // 3. Enforce
    if (current > quota.maxApiCallsPerMin) {
      if (shadowMode) {
        req.log.warn(
          { tenantId, current, limit: quota.maxApiCallsPerMin },
          "quota_check: would reject (shadow mode)",
        );
        return;
      }
      return reply.status(429).send({
        code: "QUOTA_EXCEEDED",
        message: `API rate limit exceeded: ${quota.maxApiCallsPerMin} calls/min`,
        retryable: true,
        retryAfterSeconds: windowSeconds,
      });
    }
  });
};

export const quotaCheckPlugin = fp(quotaCheckPluginImpl, {
  name: "civitasone-quota-check",
  fastify: "4.x",
});
