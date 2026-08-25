/**
 * visitor-service: real-time evacuation roster (Redis-backed).
 *
 * Implements the design's `modules/evacuation/roster.ts` contract exactly:
 * a per-location Redis Hash (`ROSTER_KEY`) holding one JSON-serialized
 * `RosterEntry` per checked-in pass, plus a separate O(1) counter key
 * (`COUNT_KEY`) so `getVisitorCount` never has to `HLEN` a hash that can
 * hold up to ~5000 entries (Property 23: Evacuation Roster Consistency —
 * the counter must always equal the hash's entry count).
 *
 * Design decisions (see design.md "Evacuation Roster (Real-Time via Redis)"):
 *   - Redis Hash for O(1) add/remove/lookup per visitor, keyed by `passId`.
 *   - A separate counter key avoids HLEN on large hashes.
 *   - Roster data is ephemeral and mirrors check-in state; the `check_ins`
 *     table (modules/check-in/schema.ts) remains the source of truth.
 *   - `visitorName`/`contactNumber` are stored decrypted in the roster
 *     entry — this is display/emergency-SMS data for the evacuation
 *     console and bulk-SMS flow (modules/evacuation/consumer.ts), not the
 *     encrypted-at-rest PII columns.
 *
 * Wiring (per Task 16.1 / Requirements 17.1, 17.2):
 *   `modules/check-in/consumer.ts` does not exist yet (Task 9.10). Once it
 *   is implemented, its `checkInRecord` handler MUST call `addToRoster`
 *   immediately after the check-in row is committed, and its
 *   `checkOutRecord` handler MUST call `removeFromRoster` immediately
 *   after the check-out row is committed — both OUTSIDE the DB transaction
 *   (same ordering as `cache.invalidate` calls elsewhere in this service),
 *   since the roster is a best-effort mirror, not the transactional
 *   source of truth.
 *
 * Graceful degradation (steering "Error Handling & Resilience — Graceful
 * degradation: if Redis is down, fall through to DB read; never return 500
 * for cache miss; log WARN, not ERROR"):
 *   This module intentionally does NOT catch/swallow Redis errors itself —
 *   `addToRoster`/`removeFromRoster`/`getFullRoster`/`getVisitorCount` all
 *   propagate the underlying store error to the caller. Enforcing the
 *   steering rule is the CALLER's responsibility, per call site:
 *     - `check-in` consumer (checkInRecord/checkOutRecord): the DB write
 *       has already committed by the time these are called, so a roster
 *       failure MUST NOT fail the whole consumer/message (that would cause
 *       a needless redelivery/DLQ of an already-applied check-in). Wrap the
 *       call in try/catch, log WARN (not ERROR), and continue — the roster
 *       is an ephemeral mirror and will self-heal on the next check-in/out.
 *     - `evacuation` routes (`GET /v1/visitor/evacuation/roster|count`,
 *       Task 16.4/16.5): on a Redis failure, fall through to a DB query
 *       (`SELECT ... FROM check_ins WHERE ...` / `COUNT(*)`) against
 *       `check_ins` joined with `digital_passes` for currently-checked-in
 *       passes at the location, rather than returning a 500.
 */
import { Redis } from "ioredis";

const ROSTER_KEY = (tenantId: string, locationId: string): string =>
  `visitor:${tenantId}:evacuation:roster:${locationId}`;
const COUNT_KEY = (tenantId: string, locationId: string): string =>
  `visitor:${tenantId}:evacuation:count:${locationId}`;

/**
 * One entry in a location's evacuation roster, keyed by `passId` within the
 * Redis Hash. Mirrors the design's `RosterEntry` shape verbatim.
 */
export interface RosterEntry {
  passId: string;
  /** Decrypted for display only in the evacuation context. */
  visitorName: string;
  hostName: string;
  checkInTime: string;
  lastKnownGate: string;
  /** Decrypted for emergency SMS during evacuation declare. */
  contactNumber: string;
  evacuated: boolean;
}

/**
 * Minimal raw Redis operations needed for Hash + counter roster
 * maintenance. `@civitasone/cache`'s `Cache` class only exposes
 * `get`/`set`/`del`-style read-through caching (no HSET/HDEL/HGETALL/
 * INCR/DECR primitives), so this module talks to a dedicated store
 * rather than the shared `cache` singleton from `shared/infra.ts`.
 */
interface RosterStore {
  /** Returns true iff `field` was newly created (Redis HSET semantics: 1 = new field, 0 = updated existing). */
  hset(key: string, field: string, value: string): Promise<boolean>;
  /** Returns true iff `field` actually existed and was removed (Redis HDEL semantics: >0 fields removed). */
  hdel(key: string, field: string): Promise<boolean>;
  hgetall(key: string): Promise<Record<string, string>>;
  incr(key: string): Promise<void>;
  decr(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

/** Real Redis-backed store (Sentinel on-prem / ElastiCache on AWS via REDIS_URL). */
class RedisRosterStore implements RosterStore {
  constructor(private redis: Redis) {}
  async hset(key: string, field: string, value: string): Promise<boolean> {
    // ioredis HSET resolves to the number of NEW fields added (1 = new, 0 = existing field overwritten).
    return (await this.redis.hset(key, field, value)) > 0;
  }
  async hdel(key: string, field: string): Promise<boolean> {
    // ioredis HDEL resolves to the number of fields actually removed (0 if the field wasn't present).
    return (await this.redis.hdel(key, field)) > 0;
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.redis.hgetall(key);
  }
  async incr(key: string): Promise<void> {
    await this.redis.incr(key);
  }
  async decr(key: string): Promise<void> {
    await this.redis.decr(key);
  }
  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
}

/**
 * In-memory store for dev/tests without a Redis instance, mirroring the
 * `MemoryCache` fallback in `@civitasone/cache` (same `CACHE_DRIVER=memory`
 * / missing `REDIS_URL` convention).
 */
class MemoryRosterStore implements RosterStore {
  private hashes = new Map<string, Map<string, string>>();
  private counters = new Map<string, number>();

  async hset(key: string, field: string, value: string): Promise<boolean> {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    const isNew = !h.has(field);
    h.set(field, value);
    return isNew;
  }
  async hdel(key: string, field: string): Promise<boolean> {
    const h = this.hashes.get(key);
    return h ? h.delete(field) : false;
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    const h = this.hashes.get(key);
    if (!h) return {};
    return Object.fromEntries(h);
  }
  async incr(key: string): Promise<void> {
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
  async decr(key: string): Promise<void> {
    this.counters.set(key, (this.counters.get(key) ?? 0) - 1);
  }
  async get(key: string): Promise<string | null> {
    const v = this.counters.get(key);
    return v === undefined ? null : String(v);
  }
}

let _store: RosterStore | null = null;

function getStore(): RosterStore {
  if (_store) return _store;
  const url = process.env.REDIS_URL;
  _store =
    !url || process.env.CACHE_DRIVER === "memory" ? new MemoryRosterStore() : new RedisRosterStore(new Redis(url));
  return _store;
}

/**
 * Override the roster store — test-only seam so unit tests can inject an
 * in-memory or mock store without touching `REDIS_URL`/`CACHE_DRIVER`. Pass
 * `null` to reset to the default (env-driven) store.
 */
export function setRosterStoreForTests(store: RosterStore | null): void {
  _store = store;
}

/**
 * On check-in: add a visitor to the location's evacuation roster.
 * Requirement 17.1 — the roster reflects every currently checked-in
 * visitor at the location.
 */
export async function addToRoster(tenantId: string, locationId: string, entry: RosterEntry): Promise<void> {
  const store = getStore();
  const isNewMember = await store.hset(ROSTER_KEY(tenantId, locationId), entry.passId, JSON.stringify(entry));
  // Property 23: only adjust the counter when the hash actually gained a new
  // entry. A repeat addToRoster for a passId already on the roster (e.g. a
  // multiEntryRecurring pass re-checking in without an intervening
  // checkout) is an idempotent overwrite of that entry's fields, not a new
  // occupant — incrementing here would desync the counter above the true
  // hash entry count.
  if (isNewMember) {
    await store.incr(COUNT_KEY(tenantId, locationId));
  }
}

/**
 * On check-out: remove a visitor from the location's evacuation roster.
 * Requirement 17.1 — a checked-out visitor no longer appears in the
 * roster or count.
 */
export async function removeFromRoster(tenantId: string, locationId: string, passId: string): Promise<void> {
  const store = getStore();
  const wasMember = await store.hdel(ROSTER_KEY(tenantId, locationId), passId);
  // Property 23, symmetric case: only decrement when hdel actually removed
  // something. A checkout for a passId no longer (or never) on the roster
  // (redelivered/duplicate checkOutRecord, or any check_ins/roster desync)
  // is a no-op on the hash, not a departure — decrementing here would drive
  // the counter BELOW true occupancy, the dangerous direction during a real
  // emergency headcount.
  if (wasMember) {
    await store.decr(COUNT_KEY(tenantId, locationId));
  }
}

/**
 * Emergency: get the full roster for a location (< 3s SLA for up to 5000
 * visitors — Requirement 17.2). Used by the evacuation console/dashboard
 * and the bulk-SMS evacuation-declare flow.
 */
export async function getFullRoster(tenantId: string, locationId: string): Promise<RosterEntry[]> {
  const store = getStore();
  const all = await store.hgetall(ROSTER_KEY(tenantId, locationId));
  return Object.values(all).map((v) => JSON.parse(v) as RosterEntry);
}

/**
 * Fast O(1) headcount for a location, read from the dedicated counter key
 * rather than the hash itself. Requirement 17.2.
 */
export async function getVisitorCount(tenantId: string, locationId: string): Promise<number> {
  const store = getStore();
  const count = await store.get(COUNT_KEY(tenantId, locationId));
  return parseInt(count ?? "0", 10);
}
