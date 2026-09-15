import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Redis } from "ioredis";
import { Cache, RedisCache } from "../src/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// PERF-007, Finding 1 — wildcard cache.invalidate() was a silent no-op
//
// 33 consumer.ts files across finance/hrms/procurement/works-service called
// `cache.invalidate(\`${service}:${tenantId}:${resource}:*\`)` on a write path,
// intending to bust every cached page/id under a resource. But
// `Cache.invalidate(key)` -> `store.del(key)` issues a plain Redis DEL of the
// literal key string, and DEL does not glob — a real Redis key named
// "finance:t1:masters:*" (with a literal asterisk character) is not the same
// key as "finance:t1:masters:1", so the actual cached entries were never
// removed and only self-healed after their TTL. The fix replaces every one of
// those call sites with the already-existing `cache.invalidateResource(tenantId,
// resource)`, which SCANs for the real prefix and deletes what it finds.
//
// Verified here against a REAL Redis instance (the fleet's shared dev
// container also used by services/visitor-service's *.integration.test.ts
// files) because the bug and the fix are both about actual Redis command
// semantics (DEL vs SCAN+DEL) that a MemoryCache stand-in cannot exercise.
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";
const rawRedis = new Redis(REDIS_URL);
const testKeys: string[] = [];

beforeAll(async () => {
  await rawRedis.ping();
});

afterEach(async () => {
  if (testKeys.length) {
    await rawRedis.del(...testKeys);
    testKeys.length = 0;
  }
});

afterAll(async () => {
  rawRedis.disconnect();
});

function track(key: string): string {
  testKeys.push(key);
  return key;
}

describe("Finding 1 (PERF-007): wildcard cache.invalidate() was a silent no-op on real Redis", () => {
  it("reproduces the bug: DEL on a literal '<prefix>:*' string does NOT remove the real prefixed keys", async () => {
    const store = new RedisCache(rawRedis);
    const cache = new Cache({ service: "perf007", store });
    const tenantId = "tenant-perf007-a";

    const itemKey = track(cache.makeKey(tenantId, "widget", "1"));
    const listKey = track(cache.listKey(tenantId, "widget", "hash1"));
    await cache.put(itemKey, { v: "item" });
    await cache.put(listKey, { v: "list" });

    // This is the EXACT shape the 33 buggy call sites used before this fix:
    // a template literal ending in a literal asterisk, fed to invalidate(key),
    // which issues a plain Redis DEL of that literal string.
    const brokenLiteralKey = `perf007:${tenantId}:widget:*`;
    await cache.invalidate(brokenLiteralKey);

    // Real Redis DEL does not glob -- neither real cached entry was touched.
    expect(await rawRedis.get(itemKey)).not.toBeNull();
    expect(await rawRedis.get(listKey)).not.toBeNull();
    // And the literal "*"-suffixed string was never a real key to begin with.
    expect(await rawRedis.get(brokenLiteralKey)).toBeNull();
  });

  it("the fix: cache.invalidateResource() removes every real key under the prefix on real Redis", async () => {
    const store = new RedisCache(rawRedis);
    const cache = new Cache({ service: "perf007", store });
    const tenantId = "tenant-perf007-b";

    const itemKey1 = track(cache.makeKey(tenantId, "widget", "1"));
    const itemKey2 = track(cache.makeKey(tenantId, "widget", "2"));
    const listKey = track(cache.listKey(tenantId, "widget", "hash1"));
    const otherResourceKey = track(cache.makeKey(tenantId, "gadget", "1"));

    await cache.put(itemKey1, { v: 1 });
    await cache.put(itemKey2, { v: 2 });
    await cache.put(listKey, { v: "list" });
    await cache.put(otherResourceKey, { v: "untouched" });

    await cache.invalidateResource(tenantId, "widget");

    // Every real key actually written under the resource is gone from real Redis.
    expect(await rawRedis.get(itemKey1)).toBeNull();
    expect(await rawRedis.get(itemKey2)).toBeNull();
    expect(await rawRedis.get(listKey)).toBeNull();
    // A different resource under the same tenant is untouched.
    expect(await rawRedis.get(otherResourceKey)).not.toBeNull();
  });

  it("matches the exact multi-segment resource shape used by works-service/proposal/consumer.ts", async () => {
    // works-service's proposal consumer invalidated `works:${tenantId}:master:work_proposals:*`
    // -- a resource name that itself contains a ":" (two segments: "master", "work_proposals").
    // Confirms invalidateResource's prefix-match also works for that shape.
    const store = new RedisCache(rawRedis);
    const cache = new Cache({ service: "works", store });
    const tenantId = "tenant-perf007-e";

    const page1 = track(cache.makeKey(tenantId, "master:work_proposals", "1:20"));
    const page2 = track(cache.makeKey(tenantId, "master:work_proposals", "21:40"));
    const otherTable = track(cache.makeKey(tenantId, "master:contractors", "1:20"));

    await cache.put(page1, { v: "page1" });
    await cache.put(page2, { v: "page2" });
    await cache.put(otherTable, { v: "other-table" });

    await cache.invalidateResource(tenantId, "master:work_proposals");

    expect(await rawRedis.get(page1)).toBeNull();
    expect(await rawRedis.get(page2)).toBeNull();
    expect(await rawRedis.get(otherTable)).not.toBeNull();
  });
});
