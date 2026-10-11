/**
 * module-cache-invalidation — the gateway-worker consumer of the post-commit
 * admin.composition.enforcement_mode_changed event (ST-M01-02). It cannot clear
 * the app process cache itself, so it forwards to the app's internal endpoint;
 * the endpoint test below proves that endpoint really drops the cache.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { registerModuleCacheInvalidation, ENFORCEMENT_MODE_CHANGED_TOPIC } from "../src/module-cache-invalidation.js";
import { _test } from "../src/module-guard.js";
import { buildApp } from "../src/app.js";

const TID = "22222222-3333-4000-8000-000000000001";
const SECRET_VALUE = "unit-test-internal-value";

function seedCache(tid: string): void {
  _test.moduleCache.set(tid, { modules: new Set(["finance"]), mode: "enforce", configured: true, expires: Date.now() + 60_000 } as never);
  _test.lastKnownMode.set(tid, "enforce" as never);
}
function evt(tenantId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: ENFORCEMENT_MODE_CHANGED_TOPIC, tenantId, actorId: "a", correlationId: "c",
    schemaVersion: "1.0", payload,
  } as never;
}

beforeEach(() => {
  _test.moduleCache.clear();
  _test.lastKnownMode.clear();
});

describe("registerModuleCacheInvalidation (worker consumer)", () => {
  it("forwards the tenant id to the invalidator when the enforcement mode changes", async () => {
    const invalidate = vi.fn(async () => undefined);
    const q = new MemoryQueue();
    registerModuleCacheInvalidation(q, invalidate);
    await q.start();
    await q.publish(ENFORCEMENT_MODE_CHANGED_TOPIC, evt(TID, { tenantId: TID, mode: "off" }));
    await q.drain();
    expect(invalidate).toHaveBeenCalledWith(TID);
    await q.stop();
  });

  it("ignores a message with no tenant id", async () => {
    const invalidate = vi.fn(async () => undefined);
    const q = new MemoryQueue();
    registerModuleCacheInvalidation(q, invalidate);
    await q.start();
    await q.publish(ENFORCEMENT_MODE_CHANGED_TOPIC, evt("", {}));
    await q.drain();
    expect(invalidate).not.toHaveBeenCalled();
    await q.stop();
  });

  it("swallows an invalidator failure (60s TTL remains the bound)", async () => {
    const invalidate = vi.fn(async () => { throw new Error("gateway down"); });
    const q = new MemoryQueue();
    registerModuleCacheInvalidation(q, invalidate);
    await q.start();
    await q.publish(ENFORCEMENT_MODE_CHANGED_TOPIC, evt(TID, { tenantId: TID }));
    await q.drain();
    expect(invalidate).toHaveBeenCalledTimes(1);
    await q.stop();
  });
});

describe("POST /internal/module-cache/invalidate (gateway app)", () => {
  async function withApp<T>(fn: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<T>): Promise<T> {
    const prev = process.env.INTERNAL_SERVICE_SECRET;
    process.env.INTERNAL_SERVICE_SECRET = SECRET_VALUE;
    const app = await buildApp();
    try { return await fn(app); } finally {
      await app.close();
      if (prev === undefined) delete process.env.INTERNAL_SERVICE_SECRET; else process.env.INTERNAL_SERVICE_SECRET = prev;
    }
  }

  it("drops the cached entry and sticky mode with a valid internal secret", async () => {
    seedCache(TID);
    const res = await withApp((app) => app.inject({
      method: "POST", url: "/internal/module-cache/invalidate",
      headers: { "x-internal-secret": SECRET_VALUE }, payload: { tenantId: TID },
    }));
    expect(res.statusCode).toBe(200);
    expect(_test.moduleCache.has(TID)).toBe(false);
    expect(_test.lastKnownMode.has(TID)).toBe(false);
  });

  it("rejects a missing or wrong secret (403) and leaves the cache untouched", async () => {
    seedCache(TID);
    const noSecret = await withApp((app) => app.inject({ method: "POST", url: "/internal/module-cache/invalidate", payload: { tenantId: TID } }));
    const wrong = await withApp((app) => app.inject({
      method: "POST", url: "/internal/module-cache/invalidate",
      headers: { "x-internal-secret": "x".repeat(SECRET_VALUE.length) }, payload: { tenantId: TID },
    }));
    expect(noSecret.statusCode).toBe(403);
    expect(wrong.statusCode).toBe(403);
    expect(_test.moduleCache.has(TID)).toBe(true);
  });

  it("rejects a non-uuid tenant id (400)", async () => {
    const res = await withApp((app) => app.inject({
      method: "POST", url: "/internal/module-cache/invalidate",
      headers: { "x-internal-secret": SECRET_VALUE }, payload: { tenantId: "not-a-uuid" },
    }));
    expect(res.statusCode).toBe(400);
  });
});
