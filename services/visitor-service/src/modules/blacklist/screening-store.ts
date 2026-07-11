/**
 * visitor-service: blacklist/watchlist screening hash-set sync (Redis).
 *
 * Maintains the two Redis Sets the design's cache-key table (design.md
 * "Redis Cache Keys") documents:
 *   `visitor:{tid}:blacklist:hashes` — identity document hashes currently
 *     blacklisted (populated only once a blacklist entry transitions to
 *     `active` via `blacklistApprove` — `pending` entries never screen).
 *   `visitor:{tid}:watchlist:hashes` — identity document hashes on the
 *     watchlist (populated immediately on `watchlistAdd`; no maker-checker).
 *
 * These sets are what `modules/visit-request/routes.ts` (Task 6.10)
 * `SISMEMBER`s against synchronously (via `isBlacklisted()` below) before
 * publishing a visit request, and what the gate-terminal sync endpoint
 * (design.md "Gate Terminal Offline Support") ships down to kiosks every 5
 * minutes.
 *
 * `@civitasone/cache`'s `Cache` class only exposes get/set/del-style
 * read-through caching (no SADD/SISMEMBER primitives) — same reasoning as
 * `modules/evacuation/roster.ts`'s dedicated `RosterStore`, so this module
 * talks to its own minimal store rather than the shared `cache` singleton.
 *
 * Graceful degradation (steering "Error Handling & Resilience — Graceful
 * degradation"): this module does NOT catch/swallow Redis errors itself —
 * `addToBlacklistHashSet`/`addToWatchlistHashSet` propagate the underlying
 * store error to the caller. The consumer call sites (./consumer.ts) are
 * responsible for wrapping these calls in try/catch AFTER the DB
 * transaction has already committed: a hash-set sync failure must NOT
 * fail/retry an already-approved blacklist entry or already-created
 * watchlist entry — the set is an ephemeral screening mirror of the DB rows,
 * not the source of truth, and can be re-synced on a subsequent
 * approval/add or a future full-resync job.
 */
import { Redis } from "ioredis";

const BLACKLIST_HASHES_KEY = (tenantId: string): string => `visitor:${tenantId}:blacklist:hashes`;
const WATCHLIST_HASHES_KEY = (tenantId: string): string => `visitor:${tenantId}:watchlist:hashes`;

/**
 * Minimal raw Redis Set operations needed for screening hash-set
 * maintenance, mirroring `evacuation/roster.ts`'s `RosterStore` seam.
 * `isMember` backs `modules/visit-request/routes.ts` (Task 6.10)'s
 * synchronous `SISMEMBER` blacklist screen at visit-request submission.
 */
interface ScreeningStore {
  sadd(key: string, member: string): Promise<void>;
  isMember(key: string, member: string): Promise<boolean>;
}

/** Real Redis-backed store (Sentinel on-prem / ElastiCache on AWS via REDIS_URL). */
class RedisScreeningStore implements ScreeningStore {
  constructor(private redis: Redis) {}
  async sadd(key: string, member: string): Promise<void> {
    await this.redis.sadd(key, member);
  }
  async isMember(key: string, member: string): Promise<boolean> {
    const result = await this.redis.sismember(key, member);
    return result === 1;
  }
}

/**
 * In-memory store for dev/tests without a Redis instance, mirroring the
 * `CACHE_DRIVER=memory` / missing `REDIS_URL` convention used elsewhere in
 * this service (e.g. `evacuation/roster.ts`'s `MemoryRosterStore`).
 */
class MemoryScreeningStore implements ScreeningStore {
  private sets = new Map<string, Set<string>>();
  async sadd(key: string, member: string): Promise<void> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    s.add(member);
  }
  async isMember(key: string, member: string): Promise<boolean> {
    return this.sets.get(key)?.has(member) ?? false;
  }
}

let _store: ScreeningStore | null = null;

function getStore(): ScreeningStore {
  if (_store) return _store;
  const url = process.env.REDIS_URL;
  _store =
    !url || process.env.CACHE_DRIVER === "memory"
      ? new MemoryScreeningStore()
      : new RedisScreeningStore(new Redis(url));
  return _store;
}

/**
 * Override the screening store — test-only seam so unit tests can inject an
 * in-memory or mock store without touching `REDIS_URL`/`CACHE_DRIVER`. Pass
 * `null` to reset to the default (env-driven) store.
 */
export function setScreeningStoreForTests(store: ScreeningStore | null): void {
  _store = store;
}

/**
 * Add an identity document hash to the tenant's blacklist screening set.
 * Called after a blacklist entry is approved (transitions `pending` ->
 * `active`) — Requirement 10.4/10.6.
 */
export async function addToBlacklistHashSet(tenantId: string, identityDocHash: string): Promise<void> {
  await getStore().sadd(BLACKLIST_HASHES_KEY(tenantId), identityDocHash);
}

/**
 * Add an identity document hash to the tenant's watchlist screening set.
 * Called immediately on watchlist entry creation (no maker-checker) —
 * Requirement 10.5.
 */
export async function addToWatchlistHashSet(tenantId: string, identityDocHash: string): Promise<void> {
  await getStore().sadd(WATCHLIST_HASHES_KEY(tenantId), identityDocHash);
}

/**
 * Synchronous `SISMEMBER` blacklist screen (Requirement 1.5): true when the
 * given identity document hash is a member of the tenant's blacklist
 * screening set. Called by `modules/visit-request/routes.ts`'s
 * `POST /v1/visitor/visit-requests` handler BEFORE publishing
 * `visitRequestCreate` — a match rejects with 403 `VISITOR_BLACKLISTED`
 * without publishing anything (no reason disclosed to the caller).
 */
export async function isBlacklisted(tenantId: string, identityDocHash: string): Promise<boolean> {
  return getStore().isMember(BLACKLIST_HASHES_KEY(tenantId), identityDocHash);
}

/**
 * Synchronous `SISMEMBER` watchlist screen (Requirement 5.7): true when the
 * given identity document hash is a member of the tenant's watchlist
 * screening set. Unlike blacklist, watchlist matches do NOT block entry —
 * they allow through but raise a security-control-room alert. Called by
 * `modules/check-in/consumer.ts` after a check-in commits to determine
 * whether to dispatch a watchlist-match notification.
 */
export async function isWatchlisted(tenantId: string, identityDocHash: string): Promise<boolean> {
  return getStore().isMember(WATCHLIST_HASHES_KEY(tenantId), identityDocHash);
}
