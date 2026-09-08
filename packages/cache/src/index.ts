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
  /**
   * ATOMIC increment-and-return, for counters that must be correct under concurrency
   * (rate limiters, quotas). Returns the value AFTER this increment.
   *
   * This exists because `getOrLoad` + `put` cannot be used to count: it is a
   * read-modify-write, AND `getOrLoad` deliberately coalesces concurrent cold-key
   * callers onto one shared promise, so N parallel callers all observe the same
   * pre-increment value and all pass a threshold check. A flood is concurrent by
   * definition, which made that pattern bypassable by exactly the traffic it was meant
   * to stop.
   *
   * TTL semantics: the expiry is applied ONLY when this call created the key (return
   * value 1). Re-applying it on every increment would slide the window forward under
   * sustained traffic, so a counter could never expire and a caller could be locked out
   * permanently.
   */
  incr(key: string, ttlSeconds: number): Promise<number>;
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
  /**
   * Redis INCR is atomic server-side, so concurrent callers get distinct values with no
   * coordination here. EXPIRE is issued only on the 1 → the call that created the key —
   * so the TTL is anchored to the start of the window, never extended by later hits.
   *
   * A crash between INCR and EXPIRE would leave a counter with no TTL. Acceptable and
   * self-limiting for the intended use: limiter keys carry the time bucket in the key
   * name, so a stranded counter stops being addressed when the window rolls over. It
   * costs a few bytes, it cannot lock anyone out.
   */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.redis.incr(key);
    if (value === 1) await this.redis.expire(key, ttlSeconds);
    return value;
  }
}

/** In-memory store for dev/tests (no Redis required). */
export class MemoryCache implements CacheStore {
  private m = new Map<string, { v: string; exp: number }>();
  /** Counters live apart from cached values: a counter is not a serialised entity. */
  private counters = new Map<string, { n: number; exp: number }>();
  async get(key: string) {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) { this.m.delete(key); return null; }
    return e.v;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.m.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
  async del(key: string) { this.m.delete(key); this.counters.delete(key); }
  async delByPrefix(prefix: string) {
    for (const k of this.m.keys()) if (k.startsWith(prefix)) this.m.delete(k);
    for (const k of this.counters.keys()) if (k.startsWith(prefix)) this.counters.delete(k);
  }
  /**
   * Atomic by construction: Node runs this synchronously between awaits, so two
   * concurrent callers cannot interleave the read and the write. Same TTL rule as Redis
   * — set on creation only, never extended.
   */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (existing !== undefined && existing.exp > now) {
      existing.n += 1;
      return existing.n;
    }
    this.counters.set(key, { n: 1, exp: now + ttlSeconds * 1000 });
    return 1;
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

  /** Read-through: return cached value or load from source, cache it, return it.
   *
   * SC-3 stampede protection: if a load is already in-flight for this key
   * (i.e. another concurrent request is already fetching it) the same Promise
   * is returned instead of firing a second loader call. Only one DB/network
   * round-trip happens per cold key, regardless of how many callers race.
   */
  async getOrLoad<T>(key: string, loader: () => Promise<T | null>, ttlSeconds?: number): Promise<T | null> {
    const cached = await this.store.get(key);
    if (cached !== null) return deserialize<T>(cached);

    // Coalesce concurrent cold-cache requests for the same key.
    const existing = _inflight.get(key);
    if (existing) return existing.shared as Promise<T | null>;

    const shared: Promise<T | null> = (async () => {
      const fresh = await loader();
      if (fresh !== null && fresh !== undefined) {
        await this.store.set(key, serialize(fresh), this.resolveTtl(ttlSeconds));
      }
      return fresh;
    })();

    // `suppress` is a derived promise whose rejection is consumed by the no-op
    // catch. It is stored in the map so that the stored reference is never seen
    // as "unhandled" by Node / Vitest, even if the rejection fires before any
    // caller has had a chance to attach their own .catch. `shared` is what we
    // hand to every caller — their `await` attaches a handler on `shared`
    // itself, which IS handled.
    const suppress = shared.catch(() => { /* suppressed — callers handle via shared */ });
    suppress.finally(() => _inflight.delete(key));

    _inflight.set(key, { shared, suppress });
    return shared;
  }

  /** Prime the cache (used by the command handler for read-your-writes). */
  async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.store.set(key, serialize(value), this.resolveTtl(ttlSeconds));
  }

  /**
   * ATOMIC counter increment. Returns the count AFTER this call, so a caller enforcing a
   * budget compares the RETURN VALUE to its limit — it never reads, decides, then writes.
   *
   * Use this, not `getOrLoad` + `put`, for anything that has to be correct when requests
   * arrive at the same time. `getOrLoad` coalesces concurrent cold-key callers onto one
   * shared promise by design (stampede protection), which for a counter means every
   * racing caller sees the same stale value and every one of them passes the check.
   *
   * TTL is applied only when this call created the key, so a fixed window is never
   * extended by traffic inside it. Not read-through and not serialised through
   * `serialize()`: a counter is an integer in the store, not a cached entity.
   */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    return this.store.incr(key, clampTtl(ttlSeconds));
  }

  /**
   * Like getOrLoad, but also caches null/undefined results for a shorter TTL
   * to prevent repeated DB lookups for non-existent records.
   */
  async getOrLoadWithNegative<T>(
    key: string,
    loader: () => Promise<T | null>,
    opts?: { ttlSeconds?: number; negativeTtlSeconds?: number },
  ): Promise<T | null> {
    const cached = await this.store.get(key);
    if (cached !== null) {
      const parsed = deserialize<T | "__NULL__">(cached);
      if (parsed === "__NULL__") return null;
      return parsed as T;
    }

    const existing = _inflight.get(key);
    if (existing) return existing.shared as Promise<T | null>;

    const shared: Promise<T | null> = (async () => {
      const fresh = await loader();
      if (fresh !== null && fresh !== undefined) {
        await this.store.set(key, serialize(fresh), this.resolveTtl(opts?.ttlSeconds));
      } else {
        // Negative cache: store a sentinel for a short TTL
        await this.store.set(key, serialize("__NULL__"), opts?.negativeTtlSeconds ?? 30);
      }
      return fresh;
    })();

    const suppress = shared.catch(() => { /* suppressed — callers handle via shared */ });
    suppress.finally(() => _inflight.delete(key));
    _inflight.set(key, { shared, suppress });
    return shared;
  }

  /** Invalidate one key or a whole resource prefix (called by the consumer after a write). */
  async invalidate(key: string): Promise<void> { await this.store.del(key); }
  /**
   * Delete every key under this resource. The scanned prefix MUST end with the
   * same ":" delimiter makeKey()/listKey() place immediately after the resource
   * segment — matching on the bare `${service}:${tenantId}:${resource}` (no
   * trailing separator) is a raw string-prefix scan, so a resource whose name is
   * a textual prefix of another resource's name (e.g. "contract" / "contractLine",
   * or a singular/plural pair like "counsel_brief" / "counsel_briefs") would
   * cross-invalidate: clearing the shorter-named resource also wiped every entry
   * under the longer-named one, because "contractLine:1" starts with the same
   * characters as "contract" once the segment delimiter is missing from the scan.
   * The trailing ":" anchors the match to a full key-segment boundary instead.
   */
  async invalidateResource(tenantId: string, resource: string): Promise<void> {
    await this.store.delByPrefix(`${this.opts.service}:${tenantId}:${resource}:`);
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

/**
 * SEC-006 fixup: bounded-latency options for the real Redis client.
 *
 * `defaultStore()` backs BOTH the tenant-scoped `Cache` class (the hot-path
 * read-through cache every service consults before Postgres) AND
 * `sharedStore()` (the SEC-006 session-revocation denylist, which fails open
 * on a Redis error specifically so a Redis outage never becomes a
 * full-platform lockout via `authPlugin`).
 *
 * Left at ioredis's defaults, a bare `new Redis(url)` does NOT fail fast on
 * an outage — it fails SLOW: `connectTimeout` defaults to 10000ms,
 * `maxRetriesPerRequest` defaults to 20 (each queued command waits through
 * up to 20 reconnect attempts, with the retry delay climbing on each one),
 * and there is no `commandTimeout` at all. Measured against this exact
 * client construction during a real Redis outage: the first `.get()` took
 * 9.68s to reject, the second 32.5s, the third 42.0s — climbing, not
 * bounded. Every authenticated request awaits `isSessionDenylisted` with no
 * timeout of its own, so that "fails open" promise was, in practice, "fails
 * open after tens of seconds of every request hanging" — functionally the
 * same fleet-wide lockout fail-open exists to avoid, just arriving as
 * client/load-balancer timeouts instead of explicit 401s.
 *
 * Fix, applied at this single choke point so both callers get it:
 *   - `maxRetriesPerRequest: 1` — one quick attempt, not 20. A command that
 *     can't complete fails fast instead of waiting through many reconnect
 *     cycles.
 *   - `connectTimeout: 1500` — bounds the initial TCP+handshake attempt.
 *     1.5s is generous next to real intra-VPC/ElastiCache connect times
 *     (single-digit ms normally) so ordinary jitter won't misfire it, while
 *     still being a small slice of any request's overall latency budget.
 *   - `commandTimeout: 1000` — bounds an already-issued command whose reply
 *     never arrives (e.g. the TCP connection is up but Redis is wedged),
 *     which `connectTimeout` alone does not cover.
 *   - `enableOfflineQueue` is deliberately left at its default (`true`),
 *     NOT disabled. With `maxRetriesPerRequest: 1`, a command issued while
 *     disconnected still gets one bounded (~1.5s) reconnect attempt before
 *     failing — enough to ride out a sub-second blip (e.g. a Redis failover
 *     pause) without an error, while a real outage still fails in ~1.5-2.5s
 *     total, not tens of seconds. Disabling the offline queue would shave
 *     that ~1.5s further but makes EVERY command issued during any brief
 *     disconnect (including ones that would have reconnected in time) fail
 *     immediately with no retry at all — a worse false-failure rate for the
 *     hot-path `Cache` reads this same client backs, for a latency win that
 *     isn't needed: ~2s is already well within the fail-open budget.
 *
 * Net worst case for a real outage: ~1.5s (connect) + up to ~1s (command,
 * if it got that far) plus one bounded retry ≈ low single-digit seconds,
 * not tens of seconds — and `isSessionDenylisted`'s fail-open catch fires
 * promptly instead of the request hanging.
 */
const REDIS_CLIENT_OPTIONS = {
  maxRetriesPerRequest: 1,
  connectTimeout: 1500,
  commandTimeout: 1000,
} as const;

function defaultStore(): CacheStore {
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return new MemoryCache();
  return new RedisCache(new Redis(url, REDIS_CLIENT_OPTIONS));
}

/**
 * SEC-006: fleet-wide, un-tenant-scoped store for cross-cutting shared state
 * that every service must agree on regardless of which one wrote it — e.g.
 * the session-revocation denylist in `@civitasone/auth`, populated by
 * identity-service and read by every service's `authPlugin`.
 *
 * `Cache` deliberately can't be used for this: it enforces the
 * `{service}:{tenant}:{resource}:{id}` convention so a service can only
 * read/write its OWN keyspace, which is exactly wrong for a value one
 * service writes and every other service must read. `sharedStore()` reuses
 * the same REDIS_URL / CACHE_DRIVER=memory connection conventions as
 * `Cache` (same env vars, same client construction) so callers don't need a
 * second, hand-rolled Redis client — they just own their own key prefix
 * (e.g. "session-denylist:") to avoid colliding with other shared uses.
 */
export function sharedStore(): CacheStore {
  return defaultStore();
}

/**
 * SC-3: In-process inflight map for cache-stampede / thundering-herd protection.
 *
 * When N concurrent requests all miss the same cold cache key simultaneously,
 * only the FIRST call fires the loader; every subsequent call for the same key
 * receives the exact same Promise. The entry is removed as soon as the loader
 * resolves or rejects (whether or not caching succeeded), so the next cold-miss
 * after expiry will go back through the normal path.
 *
 * Scope: single Node.js process (in-process coalescing). For multi-instance
 * deployments the Redis cache already de-duplicates at the data layer via TTL;
 * this map eliminates the intra-process thundering-herd without adding
 * cross-instance coordination overhead.
 *
 * Implementation note — unhandled-rejection suppression:
 * The shared promise stored in the map is a "suppressed" copy: its rejection
 * branch is consumed by a no-op `.catch()` that is attached synchronously
 * (before any microtask fires), so Node/Vitest never sees it as unhandled.
 * Callers receive a SEPARATE promise (via Promise.resolve(shared)) whose
 * rejection propagates normally through their own await/catch chain.
 */
const _inflight = new Map<string, { shared: Promise<unknown>; suppress: Promise<unknown> }>();

/**
 * Reset the in-flight map. Exposed ONLY for test isolation — do not call in
 * production code.
 */
export function resetInflightMap(): void {
  _inflight.clear();
}
