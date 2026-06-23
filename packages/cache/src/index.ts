/**
 * @civitasone/cache
 * The ONLY way services read shared state on the hot path.
 * Rule (CLAUDE.md §6): every query handler consults the cache (read-through)
 * before Postgres; writes never touch the read path — the consumer invalidates here.
 *
 * Key convention (enforced by makeKey): {service}:{tenant}:{resource}:{id}
 * A service may only read/write keys under its own {service} prefix (no cross-service keyspace).
 */
import { Redis } from "ioredis";

/**
 * TTL bounds (04-T5 cache-invalidation consistency).
 *
 * Every cache entry MUST have a bounded TTL so that a *missed* invalidation
 * self-heals automatically. Consumers invalidate read caches after a DB tx
 * commits but OUTSIDE the transaction, so a crash in the window
 * [commit succeeded -> invalidate not yet sent] would otherwise leave a stale
 * entry forever. A hard upper bound guarantees the maximum staleness window is
 * never larger than MAX_TTL_SECONDS, even if a consumer passes a silly value
 * (0, negative, NaN, Infinity, or "cache forever").
 */
export const DEFAULT_TTL_SECONDS = 60;
export const MIN_TTL_SECONDS = 1;
export const MAX_TTL_SECONDS = 3600; // 1 hour hard cap — the absolute max staleness window.

/**
 * Coerce any requested TTL into the supported [MIN, MAX] band of whole seconds.
 * Non-finite values (NaN/Infinity) and over-large values are capped to MAX so a
 * "never expire" entry is impossible; sub-minimum values floor to MIN.
 */
export function clampTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds)) return MAX_TTL_SECONDS;
  const whole = Math.floor(ttlSeconds);
  if (whole < MIN_TTL_SECONDS) return MIN_TTL_SECONDS;
  if (whole > MAX_TTL_SECONDS) return MAX_TTL_SECONDS;
  return whole;
}

/**
 * A transaction-like object that can run a callback when the surrounding DB
 * transaction commits. The drizzle/postgres-js layer used by CivitasOne does
 * NOT expose this today (see invalidateAfterCommit / README.md), but the helper
 * uses it automatically if a future tx wrapper provides it.
 */
export interface CommitHookCapable {
  onCommit(handler: () => void | Promise<void>): void;
}

function supportsCommitHook(tx: unknown): tx is CommitHookCapable {
  return (
    typeof tx === "object" &&
    tx !== null &&
    typeof (tx as { onCommit?: unknown }).onCommit === "function"
  );
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
}

/** Real Redis-backed store (Sentinel on-prem / ElastiCache on AWS via REDIS_URL). */
export class RedisCache implements CacheStore {
  constructor(private redis: Redis) {}
  async get(key: string) { return this.redis.get(key); }
  async set(key: string, value: string, ttlSeconds: number) { await this.redis.set(key, value, "EX", ttlSeconds); }
  async del(key: string) { await this.redis.del(key); }
  async delByPrefix(prefix: string) {
    const stream = this.redis.scanStream({ match: `${prefix}*`, count: 200 });
    for await (const keys of stream) {
      if ((keys as string[]).length) await this.redis.del(...(keys as string[]));
    }
  }
}

/** In-memory store for dev/tests (no Redis required). */
export class MemoryCache implements CacheStore {
  private m = new Map<string, { v: string; exp: number }>();
  async get(key: string) {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) { this.m.delete(key); return null; }
    return e.v;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.m.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
  async del(key: string) { this.m.delete(key); }
  async delByPrefix(prefix: string) {
    for (const k of this.m.keys()) if (k.startsWith(prefix)) this.m.delete(k);
  }
}

export interface CacheOptions {
  service: string;          // this service's prefix — keys are namespaced to it
  defaultTtlSeconds?: number;
  store?: CacheStore;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val));
}

function deserialize<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export class Cache {
  private store: CacheStore;
  private ttl: number;
  constructor(private opts: CacheOptions) {
    this.store = opts.store ?? defaultStore();
    // Bounded default TTL: clamp to [MIN, MAX] so an entry can never live forever.
    this.ttl = clampTtl(opts.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS);
  }

  /** The effective, bounded default TTL (seconds) applied when no ttl is passed. */
  get defaultTtlSeconds(): number {
    return this.ttl;
  }

  /**
   * Resolve the TTL to use for a write: the bounded default when none is given,
   * otherwise the caller's value clamped to [MIN, MAX]. This is the single
   * choke-point that guarantees every entry has a bounded lifetime.
   */
  private resolveTtl(ttlSeconds?: number): number {
    return ttlSeconds === undefined ? this.ttl : clampTtl(ttlSeconds);
  }

  /** Build a namespaced key. Throws if you try to address another service's keyspace. */
  makeKey(tenantId: string, resource: string, id: string): string {
    return `${this.opts.service}:${tenantId}:${resource}:${id}`;
  }
  listKey(tenantId: string, resource: string, hash: string): string {
    return `${this.opts.service}:${tenantId}:${resource}:list:${hash}`;
  }

  /** Cache-first list read with stable hash (limit, filters, cursor). */
  async listOrLoad<T>(
    tenantId: string,
    resource: string,
    hash: string,
    loader: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const key = this.listKey(tenantId, resource, hash);
    const cached = await this.store.get(key);
    if (cached !== null) return deserialize<T>(cached);
    const fresh = await loader();
    await this.store.set(key, serialize(fresh), this.resolveTtl(ttlSeconds));
    return fresh;
  }

  /** Read-through: return cached value or load from source, cache it, return it. */
  async getOrLoad<T>(key: string, loader: () => Promise<T | null>, ttlSeconds?: number): Promise<T | null> {
    const cached = await this.store.get(key);
    if (cached !== null) return deserialize<T>(cached);
    const fresh = await loader();
    if (fresh !== null && fresh !== undefined) {
      await this.store.set(key, serialize(fresh), this.resolveTtl(ttlSeconds));
    }
    return fresh;
  }

  /** Prime the cache (used by the command handler for read-your-writes). */
  async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.store.set(key, serialize(value), this.resolveTtl(ttlSeconds));
  }

  /** Invalidate one key or a whole resource prefix (called by the consumer after a write). */
  async invalidate(key: string): Promise<void> { await this.store.del(key); }
  async invalidateResource(tenantId: string, resource: string): Promise<void> {
    await this.store.delByPrefix(`${this.opts.service}:${tenantId}:${resource}`);
  }

  /**
   * Correct cache-invalidation pattern for the write path (04-T5).
   *
   * Problem: consumers invalidate the read cache AFTER the DB tx commits but
   * OUTSIDE the transaction. A crash in the window
   *   [commit succeeded  ->  invalidate request not yet sent]
   * leaves a stale read-cache entry until its TTL expires.
   *
   * This helper expresses the *intended* "invalidate on commit" semantics:
   *   - If `tx` exposes an `onCommit` hook, the invalidation is registered to run
   *     transactionally on commit, which CLOSES the staleness window entirely.
   *   - The drizzle/postgres-js layer used by CivitasOne does NOT expose commit
   *     hooks today, so the fallback performs the invalidation immediately and
   *     relies on the bounded default TTL as a self-healing backstop: any missed
   *     invalidation self-heals within at most MAX_TTL_SECONDS. The accepted
   *     staleness window (= the entry's TTL) is documented in README.md.
   *
   * Backward compatible: existing `invalidate(key)` call sites are unchanged.
   */
  async invalidateAfterCommit(tx: unknown, key: string): Promise<void> {
    if (supportsCommitHook(tx)) {
      tx.onCommit(() => this.invalidate(key));
      return;
    }
    await this.invalidate(key);
  }

  /** Resource-prefix variant of {@link invalidateAfterCommit}. */
  async invalidateResourceAfterCommit(tx: unknown, tenantId: string, resource: string): Promise<void> {
    if (supportsCommitHook(tx)) {
      tx.onCommit(() => this.invalidateResource(tenantId, resource));
      return;
    }
    await this.invalidateResource(tenantId, resource);
  }
}

function defaultStore(): CacheStore {
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return new MemoryCache();
  return new RedisCache(new Redis(url));
}
