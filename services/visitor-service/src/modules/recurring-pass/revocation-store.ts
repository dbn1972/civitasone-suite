/**
 * visitor-service: recurring-pass revocation Redis SET (Requirement 12.4).
 *
 * Maintains the Redis Set `visitor:{tid}:recurring_pass:revoked` holding the
 * UUIDs of suspended/revoked recurring passes. The gate-terminal sync
 * endpoint (design.md "Gate Terminal Offline Support") ships this set down
 * to kiosks every 5 minutes, and `modules/check-in/domain.ts`'s QR
 * verification flow checks membership synchronously before allowing
 * check-in for recurring-pass–type passes.
 *
 * The revocation takes effect within 30 seconds at all Gate_Terminals
 * (Requirement 12.4) because the set is updated immediately on
 * suspend/revoke, and terminals either poll the sync endpoint or perform
 * online SISMEMBER checks.
 *
 * Architecture mirrors `modules/blacklist/screening-store.ts` — a dedicated
 * minimal store (not the shared `cache` singleton) because `@civitasone/cache`
 * does not expose SADD/SISMEMBER primitives.
 *
 * Graceful degradation: this module does NOT catch/swallow Redis errors —
 * callers (./consumer.ts) are responsible for wrapping in try/catch AFTER
 * the DB transaction has already committed.
 */
import { Redis } from "ioredis";

const REVOKED_KEY = (tenantId: string): string => `visitor:${tenantId}:recurring_pass:revoked`;

/**
 * Minimal Redis Set operations needed for recurring-pass revocation sync.
 */
interface RevocationStore {
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  isMember(key: string, member: string): Promise<boolean>;
}

/** Real Redis-backed store (Sentinel on-prem / ElastiCache on AWS via REDIS_URL). */
class RedisRevocationStore implements RevocationStore {
  constructor(private redis: Redis) {}
  async sadd(key: string, member: string): Promise<void> {
    await this.redis.sadd(key, member);
  }
  async srem(key: string, member: string): Promise<void> {
    await this.redis.srem(key, member);
  }
  async isMember(key: string, member: string): Promise<boolean> {
    const result = await this.redis.sismember(key, member);
    return result === 1;
  }
}

/**
 * In-memory store for dev/tests without a Redis instance, mirroring the
 * `CACHE_DRIVER=memory` / missing `REDIS_URL` convention.
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
  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
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
 * Add a recurring pass ID to the tenant's revocation set. Called after a
 * pass is suspended or revoked (Requirement 12.4) — effective within 30s
 * at all gate terminals.
 */
export async function addToRevocationSet(tenantId: string, passId: string): Promise<void> {
  await getStore().sadd(REVOKED_KEY(tenantId), passId);
}

/**
 * Remove a recurring pass ID from the tenant's revocation set. Called when
 * a suspended pass is reactivated.
 */
export async function removeFromRevocationSet(tenantId: string, passId: string): Promise<void> {
  await getStore().srem(REVOKED_KEY(tenantId), passId);
}

/**
 * Check whether a recurring pass ID is in the tenant's revocation set.
 * Used by gate-terminal verification for sub-second revocation checks.
 */
export async function isRevoked(tenantId: string, passId: string): Promise<boolean> {
  return getStore().isMember(REVOKED_KEY(tenantId), passId);
}
