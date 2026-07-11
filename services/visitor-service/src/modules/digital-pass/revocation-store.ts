/**
 * visitor-service: digital-pass revocation store (Redis SET).
 *
 * Maintains the Redis Set `visitor:{tid}:revoked` containing pass IDs
 * that have been revoked. Gate terminals check this set via `isRevoked()`
 * during QR verification (modules/check-in/domain.ts, Property 10) to
 * reject revoked passes within seconds of revocation.
 *
 * Pattern follows `modules/blacklist/screening-store.ts` exactly:
 *   - Thin abstraction over Redis SADD/SISMEMBER
 *   - MemoryRevocationStore for dev/tests (CACHE_DRIVER=memory or no REDIS_URL)
 *   - Test seam via `setRevocationStoreForTests()`
 *   - Callers (consumer.ts) wrap calls in try/catch AFTER DB tx commit —
 *     a Redis sync failure must NOT fail an already-committed revocation
 *
 * Graceful degradation: this module propagates Redis errors to the caller.
 * The consumer call sites are responsible for try/catch after commit.
 */
import { Redis } from "ioredis";

const REVOKED_SET_KEY = (tenantId: string): string => `visitor:${tenantId}:revoked`;

/**
 * Minimal Redis Set operations for revocation checking.
 */
interface RevocationStore {
  sadd(key: string, member: string): Promise<void>;
  isMember(key: string, member: string): Promise<boolean>;
}

/** Real Redis-backed store (Sentinel on-prem / ElastiCache on AWS via REDIS_URL). */
class RedisRevocationStore implements RevocationStore {
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
 * this service (e.g. `blacklist/screening-store.ts`'s `MemoryScreeningStore`).
 */
class MemoryRevocationStore implements RevocationStore {
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

let _store: RevocationStore | null = null;

function getStore(): RevocationStore {
  if (_store) return _store;
  const url = process.env.REDIS_URL;
  _store =
    !url || process.env.CACHE_DRIVER === "memory"
      ? new MemoryRevocationStore()
      : new RedisRevocationStore(new Redis(url));
  return _store;
}

/**
 * Override the revocation store — test-only seam so unit tests can inject an
 * in-memory or mock store without touching `REDIS_URL`/`CACHE_DRIVER`. Pass
 * `null` to reset to the default (env-driven) store.
 */
export function setRevocationStoreForTests(store: RevocationStore | null): void {
  _store = store;
}

/**
 * Add a pass ID to the tenant's revocation set (Requirement 4.5).
 * Called after a digital pass is revoked — the gate terminal's
 * `isRevoked()` check will immediately reject subsequent QR scans.
 */
export async function addToRevokedSet(tenantId: string, passId: string): Promise<void> {
  await getStore().sadd(REVOKED_SET_KEY(tenantId), passId);
}

/**
 * Check whether a pass ID is in the tenant's revocation set (Property 10).
 * Called by `modules/check-in/domain.ts`'s QR verification during gate scan.
 */
export async function isRevoked(tenantId: string, passId: string): Promise<boolean> {
  return getStore().isMember(REVOKED_SET_KEY(tenantId), passId);
}
