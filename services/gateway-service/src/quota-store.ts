/**
 * Quota store implementations — Redis-backed (fleet-wide) and in-memory (dev fallback).
 *
 * Env vars:
 *   REDIS_URL / GATEWAY_REDIS_URL — Redis connection string (redis://host:port)
 *
 * When Redis is configured, rate limits and quota counters are shared across all
 * gateway replicas, enforcing correct fleet-wide limits. When unconfigured (dev),
 * falls back to per-process in-memory maps (same as before but explicitly labeled).
 */
import type { QuotaCheckStore } from "@civitasone/db";

// ── In-memory (dev/single-pod fallback) ───────────────────────────

export function createInMemoryQuotaStore(): QuotaCheckStore {
  const _d = new Map<string, { v: string; e: number }>();
  const _c = new Map<string, { n: number; e: number }>();
  return {
    async get(k: string) { const e = _d.get(k); return (e && e.e > Date.now()) ? e.v : null; },
    async set(k: string, v: string, t: number) { _d.set(k, { v, e: Date.now() + t * 1000 }); },
    async incr(k: string, t: number) { const now = Date.now(); const e = _c.get(k); if (e && e.e > now) { e.n++; return e.n; } _c.set(k, { n: 1, e: now + t * 1000 }); return 1; },
  };
}

// ── Redis-backed (production, fleet-wide) ─────────────────────────

const INCR_WITH_TTL_LUA =
  "local v=redis.call('INCR',KEYS[1]); if v==1 or redis.call('TTL',KEYS[1])<0 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return v";

export async function createRedisQuotaStore(url: string): Promise<QuotaCheckStore> {
  // Dynamic import — ioredis is an optional runtime dep for the gateway.
  // At runtime, ioredis must be installed when REDIS_URL is set.
  // We use a type-only cast here since the dep is optional.
  const mod = await import("ioredis" as string) as { default: new (url: string, opts: object) => { connect(): Promise<void>; get(k: string): Promise<string | null>; set(k: string, v: string, mode: string, ttl: number): Promise<unknown>; incr(k: string): Promise<number>; expire(k: string, s: number): Promise<unknown>; eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> } };
  const Redis = mod.default;
  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  await redis.connect();

  return {
    async get(k: string): Promise<string | null> {
      return redis.get(`gw:quota:${k}`);
    },
    async set(k: string, v: string, ttlSeconds: number): Promise<void> {
      await redis.set(`gw:quota:${k}`, v, "EX", ttlSeconds);
    },
    async incr(k: string, ttlSeconds: number): Promise<number> {
      const key = `gw:quota:ctr:${k}`;
      // Single atomic round trip: INCR and (re)arm the TTL together. Setting the TTL only when the
      // key has none (first hit, or a key orphaned by a crash between INCR and EXPIRE) means the
      // window is fixed from the first hit and a TTL-less counter can never persist (CLOS3-S5-11).
      const val = await redis.eval(INCR_WITH_TTL_LUA, 1, key, ttlSeconds) as number;
      return val;
    },
  };
}
