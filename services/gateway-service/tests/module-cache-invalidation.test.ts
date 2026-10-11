/**
 * module-cache-invalidation — the gateway worker consumer that drops the
 * module-guard cache when a tenant's module set changes (ST-M01-02). Verifies
 * that publishing admin.module.toggle / admin.composition.apply_plan invokes
 * invalidateModuleCache for the affected tenant, so a disabled module is
 * enforced without waiting out the 60s TTL.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { registerModuleCacheInvalidation, MODULE_TOGGLE_TOPIC, COMPOSITION_APPLY_TOPIC } from "../src/module-cache-invalidation.js";
import { _test } from "../src/module-guard.js";

const TID = "22222222-3333-4000-8000-000000000001";

function seedCache(tid: string): void {
  _test.moduleCache.set(tid, { modules: new Set(["finance"]), mode: "enforce", configured: true, expires: Date.now() + 60_000 } as never);
  _test.lastKnownMode.set(tid, "enforce" as never);
}

beforeEach(() => {
  _test.moduleCache.clear();
  _test.lastKnownMode.clear();
});

describe("registerModuleCacheInvalidation", () => {
  it("drops the cached entry + sticky mode on a module toggle", async () => {
    const q = new MemoryQueue();
    registerModuleCacheInvalidation(q);
    await q.start();
    seedCache(TID);
    expect(_test.moduleCache.has(TID)).toBe(true);

    await q.publish(MODULE_TOGGLE_TOPIC, {
      messageId: randomUUID(), type: MODULE_TOGGLE_TOPIC, tenantId: TID, actorId: "a", correlationId: "c",
      schemaVersion: "1.0", payload: { tenantId: TID, moduleKey: "finance", enabled: false },
    } as never);
    await q.drain();

    expect(_test.moduleCache.has(TID)).toBe(false);
    expect(_test.lastKnownMode.has(TID)).toBe(false);
    await q.stop();
  });

  it("drops the cached entry on a composition apply-plan", async () => {
    const q = new MemoryQueue();
    registerModuleCacheInvalidation(q);
    await q.start();
    seedCache(TID);

    await q.publish(COMPOSITION_APPLY_TOPIC, {
      messageId: randomUUID(), type: COMPOSITION_APPLY_TOPIC, tenantId: TID, actorId: "a", correlationId: "c",
      schemaVersion: "1.0", payload: { tenantId: TID },
    } as never);
    await q.drain();

    expect(_test.moduleCache.has(TID)).toBe(false);
    await q.stop();
  });

  it("ignores a message with no tenant id (no throw, no clear of others)", async () => {
    const q = new MemoryQueue();
    registerModuleCacheInvalidation(q);
    await q.start();
    seedCache(TID);

    await q.publish(MODULE_TOGGLE_TOPIC, {
      messageId: randomUUID(), type: MODULE_TOGGLE_TOPIC, tenantId: "", actorId: "a", correlationId: "c",
      schemaVersion: "1.0", payload: {},
    } as never);
    await q.drain();

    // The seeded (different) tenant's entry is untouched.
    expect(_test.moduleCache.has(TID)).toBe(true);
    await q.stop();
  });
});
