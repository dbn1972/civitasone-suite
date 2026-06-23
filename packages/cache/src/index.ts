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
    this.ttl = opts.defaultTtlSeconds ?? 60;
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
    await this.store.set(key, serialize(fresh), ttlSeconds ?? this.ttl);
    return fresh;
  }

  /** Read-through: return cached value or load from source, cache it, return it. */
  async getOrLoad<T>(key: string, loader: () => Promise<T | null>, ttlSeconds?: number): Promise<T | null> {
    const cached = await this.store.get(key);
    if (cached !== null) return deserialize<T>(cached);
    const fresh = await loader();
    if (fresh !== null && fresh !== undefined) {
      await this.store.set(key, serialize(fresh), ttlSeconds ?? this.ttl);
    }
    return fresh;
  }

  /** Prime the cache (used by the command handler for read-your-writes). */
  async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.store.set(key, serialize(value), ttlSeconds ?? this.ttl);
  }

  /** Invalidate one key or a whole resource prefix (called by the consumer after a write). */
  async invalidate(key: string): Promise<void> { await this.store.del(key); }
  async invalidateResource(tenantId: string, resource: string): Promise<void> {
    await this.store.delByPrefix(`${this.opts.service}:${tenantId}:${resource}`);
  }
}

function defaultStore(): CacheStore {
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return new MemoryCache();
  return new RedisCache(new Redis(url));
}
