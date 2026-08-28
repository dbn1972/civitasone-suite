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
 * minutes. Other code (e.g. integration tests proving a real key/hash
 * mismatch) reads these keys directly with raw `SISMEMBER`, so the key
 * MUST stay a plain Redis Set — expiry metadata (Fix 3) is tracked in a
 * separate companion Hash key (`{key}:expiry`), never by changing the
 * primary key's Redis type.
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
 *
 * Fix 3 (expiry enforcement): `isMember()` now also consults the member's
 * expiry (if any) recorded in the companion `{key}:expiry` Hash — a member
 * whose expiry has passed is treated as ABSENT, and is lazily removed from
 * both the primary Set and the expiry Hash (self-heals on read, no separate
 * sweep worker required). This is fully backward compatible: a member added
 * with no `expiresAt` (every watchlist entry, and any 2-arg call) has no
 * expiry-hash entry at all and so never expires, exactly as before.
 */
import { Redis } from "ioredis";

const BLACKLIST_HASHES_KEY = (tenantId: string): string => `visitor:${tenantId}:blacklist:hashes`;
const WATCHLIST_HASHES_KEY = (tenantId: string): string => `visitor:${tenantId}:watchlist:hashes`;

/** Companion Hash key (member -> expiresAt epoch ms) holding Fix 3's expiry metadata for a Set key. */
function expiryKeyFor(key: string): string {
  return `${key}:expiry`;
}

/**
 * Minimal raw Redis Set operations needed for screening hash-set
 * maintenance, mirroring `evacuation/roster.ts`'s `RosterStore` seam.
 * `isMember` backs `modules/visit-request/routes.ts` (Task 6.10)'s
 * synchronous `SISMEMBER` blacklist screen at visit-request submission.
 *
 * `sadd`'s optional `expiresAtMs` (Fix 3) records when the member should
 * stop counting as present; omitted/`null` means "never expires" (matches
 * `blacklist/domain.ts#isExpired`'s `null` convention). The primary key
 * itself always stays a plain Set — expiry lives in a companion structure.
 */
interface ScreeningStore {
  sadd(key: string, member: string, expiresAtMs?: number | null): Promise<void>;
  isMember(key: string, member: string): Promise<boolean>;
  srem(key: string, member: string): Promise<void>;
}

/** Real Redis-backed store (Sentinel on-prem / ElastiCache on AWS via REDIS_URL). */
class RedisScreeningStore implements ScreeningStore {
  constructor(private redis: Redis) {}

  async sadd(key: string, member: string, expiresAtMs?: number | null): Promise<void> {
    await this.redis.sadd(key, member);
    if (expiresAtMs) {
      await this.redis.hset(expiryKeyFor(key), member, String(expiresAtMs));
    } else {
      // No expiry supplied — clear any stale expiry entry from a prior add
      // (e.g. a permanent re-approval after a previously time-boxed one).
      await this.redis.hdel(expiryKeyFor(key), member);
    }
  }

  async isMember(key: string, member: string): Promise<boolean> {
    const isMember = await this.redis.sismember(key, member);
    if (isMember !== 1) return false;

    const expiresAtRaw = await this.redis.hget(expiryKeyFor(key), member);
    if (expiresAtRaw === null) return true; // no recorded expiry -> never expires

    const expiresAtMs = Number(expiresAtRaw);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      // Lazily evict the expired member so the set self-heals without a
      // separate sweep worker (Fix 3).
      await this.redis.srem(key, member);
      await this.redis.hdel(expiryKeyFor(key), member);
      return false;
    }
    return true;
  }

  async srem(key: string, member: string): Promise<void> {
    await this.redis.srem(key, member);
    await this.redis.hdel(expiryKeyFor(key), member);
  }
}

/**
 * In-memory store for dev/tests without a Redis instance, mirroring the
 * `CACHE_DRIVER=memory` / missing `REDIS_URL` convention used elsewhere in
 * this service (e.g. `evacuation/roster.ts`'s `MemoryRosterStore`).
 */
class MemoryScreeningStore implements ScreeningStore {
  private sets = new Map<string, Set<string>>();
  private expiries = new Map<string, Map<string, number>>();

  async sadd(key: string, member: string, expiresAtMs?: number | null): Promise<void> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    s.add(member);

    if (expiresAtMs) {
      let e = this.expiries.get(key);
      if (!e) {
        e = new Map();
        this.expiries.set(key, e);
      }
      e.set(member, expiresAtMs);
    } else {
      this.expiries.get(key)?.delete(member);
    }
  }

  async isMember(key: string, member: string): Promise<boolean> {
    const s = this.sets.get(key);
    if (!s || !s.has(member)) return false;

    const expiresAtMs = this.expiries.get(key)?.get(member);
    if (expiresAtMs === undefined) return true; // no recorded expiry -> never expires
    if (expiresAtMs <= Date.now()) {
      s.delete(member); // self-heal, mirrors RedisScreeningStore's lazy SREM
      this.expiries.get(key)?.delete(member);
      return false;
    }
    return true;
  }

  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
    this.expiries.get(key)?.delete(member);
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
 *
 * `expiresAt` (Fix 3) mirrors the DB row's `expiresAt`: omitted or `null`
 * means the entry never expires (blocks permanently, same as before this
 * fix); a concrete Date means `isBlacklisted()` stops treating this hash as
 * blocked once that instant passes.
 */
export async function addToBlacklistHashSet(tenantId: string, identityDocHash: string, expiresAt?: Date | null): Promise<void> {
  await getStore().sadd(BLACKLIST_HASHES_KEY(tenantId), identityDocHash, expiresAt ? expiresAt.getTime() : null);
}

/**
 * Add an identity document hash to the tenant's watchlist screening set.
 * Called immediately on watchlist entry creation (no maker-checker) —
 * Requirement 10.5. Watchlist entries have no expiry concept.
 */
export async function addToWatchlistHashSet(tenantId: string, identityDocHash: string): Promise<void> {
  await getStore().sadd(WATCHLIST_HASHES_KEY(tenantId), identityDocHash);
}

/**
 * Remove an identity document hash from the tenant's blacklist screening
 * set immediately — used when a blacklist entry is deactivated/archived
 * (Fix 3: `blacklistDeactivate`) so the lifted block takes effect right
 * away rather than waiting for the (already-expiry-aware) lazy eviction on
 * next read.
 */
export async function removeFromBlacklistHashSet(tenantId: string, identityDocHash: string): Promise<void> {
  await getStore().srem(BLACKLIST_HASHES_KEY(tenantId), identityDocHash);
}

/**
 * Synchronous `SISMEMBER`-equivalent blacklist screen (Requirement 1.5):
 * true when the given identity document hash is a member of the tenant's
 * blacklist screening set AND has not expired (Fix 3 — previously this was
 * a raw, time-blind membership check; an entry approved with a past/lapsed
 * `expiresAt` now correctly stops blocking). Called by
 * `modules/visit-request/routes.ts`'s `POST /v1/visitor/visit-requests`
 * handler BEFORE publishing `visitRequestCreate` — a match rejects with 403
 * `VISITOR_BLACKLISTED` without publishing anything (no reason disclosed to
 * the caller).
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
