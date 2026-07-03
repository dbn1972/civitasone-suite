/**
 * tenant-service module tests — plans, subscriptions, quotas, settings.
 *
 * 1) Validators (pure zod — no I/O)
 * 2) Quota domain logic (isOverLimit, usagePercent, projectedOverageDate)
 * 3) Write-via-queue + read-via-cache CQRS flow per module
 * 4) Route-level auth rejection (401 for unauthenticated)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";

// ═══════════════════════════════════════════════════════════════════════
// 1. PLAN VALIDATORS
// ═══════════════════════════════════════════════════════════════════════

describe("plans validators", () => {
  let createPlanBody: typeof import("../src/modules/plans/validators.js").createPlanBody;
  let updatePlanBody: typeof import("../src/modules/plans/validators.js").updatePlanBody;

  beforeEach(async () => {
    const mod = await import("../src/modules/plans/validators.js");
    createPlanBody = mod.createPlanBody;
    updatePlanBody = mod.updatePlanBody;
  });

  it("accepts valid plan create body", () => {
    const result = createPlanBody.safeParse({
      code: "govt-basic",
      name: "Government Basic Plan",
      edition: "govt_dept",
      maxUsers: 100,
      maxStorageGb: 50,
      enabledModules: ["finance", "hrms"],
      priceMinor: 500000,
      billingCycle: "annual",
      features: { sso: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid edition", () => {
    const result = createPlanBody.safeParse({
      code: "invalid",
      name: "Invalid",
      edition: "enterprise", // not in enum
      maxUsers: 10,
      maxStorageGb: 5,
      priceMinor: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid code format", () => {
    const result = createPlanBody.safeParse({
      code: "UPPER CASE",
      name: "Test",
      edition: "psu",
      maxUsers: 10,
      maxStorageGb: 5,
      priceMinor: 0,
    });
    expect(result.success).toBe(false);
  });

  it("update requires at least one field", () => {
    const result = updatePlanBody.safeParse({});
    expect(result.success).toBe(false);
  });

  it("update accepts partial fields", () => {
    const result = updatePlanBody.safeParse({ name: "Updated Name" });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. SUBSCRIPTION VALIDATORS
// ═══════════════════════════════════════════════════════════════════════

describe("subscription validators", () => {
  let createSubscriptionBody: typeof import("../src/modules/subscriptions/validators.js").createSubscriptionBody;
  let cancelSubscriptionBody: typeof import("../src/modules/subscriptions/validators.js").cancelSubscriptionBody;

  beforeEach(async () => {
    const mod = await import("../src/modules/subscriptions/validators.js");
    createSubscriptionBody = mod.createSubscriptionBody;
    cancelSubscriptionBody = mod.cancelSubscriptionBody;
  });

  it("accepts valid subscription create body", () => {
    const result = createSubscriptionBody.safeParse({
      tenantId: "00000000-0000-4000-8000-000000000001",
      planId: "00000000-0000-4000-8000-000000000002",
      startDate: "2024-01-01T00:00:00Z",
      currentPeriodStart: "2024-01-01T00:00:00Z",
      currentPeriodEnd: "2025-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid tenantId", () => {
    const result = createSubscriptionBody.safeParse({
      tenantId: "not-a-uuid",
      planId: "00000000-0000-4000-8000-000000000002",
      startDate: "2024-01-01T00:00:00Z",
      currentPeriodStart: "2024-01-01T00:00:00Z",
      currentPeriodEnd: "2025-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("cancel requires reason of at least 3 chars", () => {
    const result = cancelSubscriptionBody.safeParse({ reason: "ab" });
    expect(result.success).toBe(false);
  });

  it("cancel accepts valid body", () => {
    const result = cancelSubscriptionBody.safeParse({ reason: "Budget cuts", immediate: true });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. QUOTA VALIDATORS + DOMAIN LOGIC
// ═══════════════════════════════════════════════════════════════════════

describe("quota validators", () => {
  let quotaSetBody: typeof import("../src/modules/quotas/validators.js").quotaSetBody;
  let quotaIncrementBody: typeof import("../src/modules/quotas/validators.js").quotaIncrementBody;
  let quotaCheckBody: typeof import("../src/modules/quotas/validators.js").quotaCheckBody;

  beforeEach(async () => {
    const mod = await import("../src/modules/quotas/validators.js");
    quotaSetBody = mod.quotaSetBody;
    quotaIncrementBody = mod.quotaIncrementBody;
    quotaCheckBody = mod.quotaCheckBody;
  });

  it("accepts valid quota set", () => {
    const result = quotaSetBody.safeParse({
      tenantId: "00000000-0000-4000-8000-000000000001",
      resource: "users",
      limit: 500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid resource type", () => {
    const result = quotaSetBody.safeParse({
      tenantId: "00000000-0000-4000-8000-000000000001",
      resource: "invalid_resource",
      limit: 500,
    });
    expect(result.success).toBe(false);
  });

  it("increment allows negative delta (decrement)", () => {
    const result = quotaIncrementBody.safeParse({
      tenantId: "00000000-0000-4000-8000-000000000001",
      resource: "storage_gb",
      delta: -10,
    });
    expect(result.success).toBe(true);
  });

  it("check defaults requestedAmount to 1", () => {
    const result = quotaCheckBody.safeParse({
      tenantId: "00000000-0000-4000-8000-000000000001",
      resource: "documents",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestedAmount).toBe(1);
    }
  });
});

describe("quota domain logic", () => {
  let isOverLimit: typeof import("../src/modules/quotas/repo.js").isOverLimit;
  let usagePercent: typeof import("../src/modules/quotas/repo.js").usagePercent;
  let projectedOverageDate: typeof import("../src/modules/quotas/repo.js").projectedOverageDate;

  beforeEach(async () => {
    const mod = await import("../src/modules/quotas/repo.js");
    isOverLimit = mod.isOverLimit;
    usagePercent = mod.usagePercent;
    projectedOverageDate = mod.projectedOverageDate;
  });

  const baseQuota = {
    id: "q1",
    tenantId: "t1",
    resource: "users" as const,
    limit: 100,
    used: 80,
    updatedAt: new Date(),
    version: 1,
  };

  it("isOverLimit returns false when used < limit", () => {
    expect(isOverLimit(baseQuota)).toBe(false);
  });

  it("isOverLimit returns true when used >= limit", () => {
    expect(isOverLimit({ ...baseQuota, used: 100 })).toBe(true);
    expect(isOverLimit({ ...baseQuota, used: 101 })).toBe(true);
  });

  it("usagePercent calculates correctly", () => {
    expect(usagePercent(baseQuota)).toBe(80);
    expect(usagePercent({ ...baseQuota, used: 50 })).toBe(50);
    expect(usagePercent({ ...baseQuota, used: 0 })).toBe(0);
  });

  it("usagePercent returns 100 when limit is 0", () => {
    expect(usagePercent({ ...baseQuota, limit: 0 })).toBe(100);
  });

  it("projectedOverageDate returns now if already over", () => {
    const result = projectedOverageDate({ ...baseQuota, used: 100 }, 5);
    expect(result).not.toBeNull();
    // Should be approximately now
    expect(result!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("projectedOverageDate returns null if no growth", () => {
    expect(projectedOverageDate(baseQuota, 0)).toBeNull();
    expect(projectedOverageDate(baseQuota, -1)).toBeNull();
  });

  it("projectedOverageDate calculates future date", () => {
    const result = projectedOverageDate({ ...baseQuota, used: 80, limit: 100 }, 5);
    expect(result).not.toBeNull();
    // 20 remaining / 5 per day = 4 days
    const expectedDays = 4;
    const diffMs = result!.getTime() - Date.now();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(expectedDays);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. SETTING VALIDATORS
// ═══════════════════════════════════════════════════════════════════════

describe("settings validators", () => {
  let settingUpsertBody: typeof import("../src/modules/settings/validators.js").settingUpsertBody;
  let settingDeleteBody: typeof import("../src/modules/settings/validators.js").settingDeleteBody;

  beforeEach(async () => {
    const mod = await import("../src/modules/settings/validators.js");
    settingUpsertBody = mod.settingUpsertBody;
    settingDeleteBody = mod.settingDeleteBody;
  });

  it("accepts valid setting key format (dot-notation)", () => {
    const result = settingUpsertBody.safeParse({
      key: "org.timezone",
      value: "Asia/Kolkata",
    });
    expect(result.success).toBe(true);
  });

  it("rejects key starting with number", () => {
    const result = settingUpsertBody.safeParse({
      key: "1invalid",
      value: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects uppercase key", () => {
    const result = settingUpsertBody.safeParse({
      key: "Org.Timezone",
      value: "test",
    });
    expect(result.success).toBe(false);
  });

  it("accepts nested jsonb value", () => {
    const result = settingUpsertBody.safeParse({
      key: "modules.enabled",
      value: { finance: true, hrms: true, procurement: false },
    });
    expect(result.success).toBe(true);
  });

  it("delete requires non-empty key", () => {
    const result = settingDeleteBody.safeParse({ key: "" });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. CQRS WIRING — Write-via-queue + Read-via-cache (plans example)
// ═══════════════════════════════════════════════════════════════════════

describe("plans CQRS flow — write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cacheInstance: Cache;
  const planStore = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cacheInstance = new Cache({ service: "tenant", store: new MemoryCache(), defaultTtlSeconds: 60 });
    planStore.clear();

    // stand-in consumer
    queue.subscribe<{ id: string; code: string; name: string; edition: string }>(
      "tenant.plan.create",
      async (msg) => {
        planStore.set(msg.payload.id, { ...msg.payload, status: "active" });
      },
    );
  });

  it("command primes cache, consumer writes to DB asynchronously", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const projected = { id, code: "psu-standard", name: "PSU Standard", edition: "psu" };

    await cacheInstance.put(cacheInstance.makeKey("t1", "plan", id), projected);
    await queue.publish("tenant.plan.create", {
      messageId: id, type: "tenant.plan.create", tenantId: "t1", actorId: "u1",
      correlationId: "c1", schemaVersion: "1.0", payload: projected,
    });

    // immediate: DB empty, cache has projected
    expect(planStore.has(id)).toBe(false);
    const fromCache = await cacheInstance.getOrLoad(
      cacheInstance.makeKey("t1", "plan", id),
      async () => null,
    );
    expect(fromCache).toEqual(projected);

    // after async delivery: DB now written
    await new Promise((r) => setTimeout(r, 20));
    expect(planStore.get(id)?.code).toBe("psu-standard");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. CQRS WIRING — Subscriptions lifecycle via queue
// ═══════════════════════════════════════════════════════════════════════

describe("subscription CQRS flow — status transitions via queue", () => {
  let queue: MemoryQueue;
  const subStore = new Map<string, { id: string; status: string; planId: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    subStore.clear();

    queue.subscribe<{ id: string; planId: string; tenantId: string }>(
      "tenant.subscription.create",
      async (msg) => {
        subStore.set(msg.payload.id, { id: msg.payload.id, status: "trial", planId: msg.payload.planId });
      },
    );

    queue.subscribe<{ id: string; newPlanId: string }>(
      "tenant.subscription.upgrade",
      async (msg) => {
        const cur = subStore.get(msg.payload.id);
        if (cur) {
          cur.status = "active";
          cur.planId = msg.payload.newPlanId;
        }
      },
    );

    queue.subscribe<{ id: string; reason: string }>(
      "tenant.subscription.cancel",
      async (msg) => {
        const cur = subStore.get(msg.payload.id);
        if (cur) cur.status = "cancelled";
      },
    );
  });

  it("creates a trial subscription, upgrades, then cancels", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const planA = "22222222-2222-4222-8222-222222222222";
    const planB = "33333333-3333-4333-8333-333333333333";

    await queue.publish("tenant.subscription.create", {
      messageId: id, type: "tenant.subscription.create", tenantId: "t1",
      actorId: "u1", correlationId: "c1", schemaVersion: "1.0",
      payload: { id, planId: planA, tenantId: "t1" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(subStore.get(id)?.status).toBe("trial");

    await queue.publish("tenant.subscription.upgrade", {
      messageId: "22222222-2222-4222-8222-222222222221", type: "tenant.subscription.upgrade", tenantId: "t1",
      actorId: "u1", correlationId: "c2", schemaVersion: "1.0",
      payload: { id, newPlanId: planB, effectiveDate: null },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(subStore.get(id)?.status).toBe("active");
    expect(subStore.get(id)?.planId).toBe(planB);

    await queue.publish("tenant.subscription.cancel", {
      messageId: "33333333-3333-4333-8333-333333333331", type: "tenant.subscription.cancel", tenantId: "t1",
      actorId: "u1", correlationId: "c3", schemaVersion: "1.0",
      payload: { id, reason: "Budget cuts", immediate: true },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(subStore.get(id)?.status).toBe("cancelled");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. CQRS WIRING — Quota increment + check via queue
// ═══════════════════════════════════════════════════════════════════════

describe("quota CQRS flow — set + increment via queue", () => {
  let queue: MemoryQueue;
  const quotaStore = new Map<string, { limit: number; used: number }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    quotaStore.clear();

    queue.subscribe<{ tenantId: string; resource: string; limit: number }>(
      "tenant.quota.set",
      async (msg) => {
        const key = `${msg.payload.tenantId}:${msg.payload.resource}`;
        quotaStore.set(key, { limit: msg.payload.limit, used: quotaStore.get(key)?.used ?? 0 });
      },
    );

    queue.subscribe<{ tenantId: string; resource: string; delta: number }>(
      "tenant.quota.increment",
      async (msg) => {
        const key = `${msg.payload.tenantId}:${msg.payload.resource}`;
        const cur = quotaStore.get(key);
        if (cur) cur.used = Math.max(0, cur.used + msg.payload.delta);
      },
    );
  });

  it("sets quota then increments usage", async () => {
    await queue.publish("tenant.quota.set", {
      messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "tenant.quota.set", tenantId: "t1",
      actorId: "u1", correlationId: "c1", schemaVersion: "1.0",
      payload: { tenantId: "t1", resource: "users", limit: 100 },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(quotaStore.get("t1:users")?.limit).toBe(100);
    expect(quotaStore.get("t1:users")?.used).toBe(0);

    await queue.publish("tenant.quota.increment", {
      messageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", type: "tenant.quota.increment", tenantId: "t1",
      actorId: "u1", correlationId: "c2", schemaVersion: "1.0",
      payload: { tenantId: "t1", resource: "users", delta: 5 },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(quotaStore.get("t1:users")?.used).toBe(5);
  });

  it("decrement does not go below 0", async () => {
    await queue.publish("tenant.quota.set", {
      messageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", type: "tenant.quota.set", tenantId: "t1",
      actorId: "u1", correlationId: "c3", schemaVersion: "1.0",
      payload: { tenantId: "t1", resource: "storage_gb", limit: 50 },
    });
    await new Promise((r) => setTimeout(r, 20));

    await queue.publish("tenant.quota.increment", {
      messageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", type: "tenant.quota.increment", tenantId: "t1",
      actorId: "u1", correlationId: "c4", schemaVersion: "1.0",
      payload: { tenantId: "t1", resource: "storage_gb", delta: -100 },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(quotaStore.get("t1:storage_gb")?.used).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. CQRS WIRING — Settings upsert + delete via queue
// ═══════════════════════════════════════════════════════════════════════

describe("settings CQRS flow — upsert + delete via queue", () => {
  let queue: MemoryQueue;
  const settingStore = new Map<string, unknown>();

  beforeEach(() => {
    queue = new MemoryQueue();
    settingStore.clear();

    queue.subscribe<{ tenantId: string; key: string; value: unknown }>(
      "tenant.setting.upsert",
      async (msg) => {
        settingStore.set(`${msg.payload.tenantId}:${msg.payload.key}`, msg.payload.value);
      },
    );

    queue.subscribe<{ tenantId: string; key: string }>(
      "tenant.setting.delete",
      async (msg) => {
        settingStore.delete(`${msg.payload.tenantId}:${msg.payload.key}`);
      },
    );
  });

  it("upserts and then deletes a setting", async () => {
    await queue.publish("tenant.setting.upsert", {
      messageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", type: "tenant.setting.upsert", tenantId: "t1",
      actorId: "u1", correlationId: "c1", schemaVersion: "1.0",
      payload: { tenantId: "t1", key: "org.timezone", value: "Asia/Kolkata" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settingStore.get("t1:org.timezone")).toBe("Asia/Kolkata");

    // upsert same key with new value
    await queue.publish("tenant.setting.upsert", {
      messageId: "ffffffff-ffff-4fff-8fff-ffffffffffff", type: "tenant.setting.upsert", tenantId: "t1",
      actorId: "u1", correlationId: "c2", schemaVersion: "1.0",
      payload: { tenantId: "t1", key: "org.timezone", value: "UTC" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settingStore.get("t1:org.timezone")).toBe("UTC");

    // delete
    await queue.publish("tenant.setting.delete", {
      messageId: "11111111-2222-4333-8444-555555555555", type: "tenant.setting.delete", tenantId: "t1",
      actorId: "u1", correlationId: "c3", schemaVersion: "1.0",
      payload: { tenantId: "t1", key: "org.timezone" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settingStore.has("t1:org.timezone")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. ROUTE AUTH — unauthenticated requests rejected on new modules
// ═══════════════════════════════════════════════════════════════════════

describe("new module routes reject unauthenticated requests (401)", () => {
  it("GET /v1/plans returns 401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/plans" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /v1/subscriptions returns 401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/subscriptions", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /v1/quotas returns 401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/quotas", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/settings returns 401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/settings" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("PUT /v1/settings returns 401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "PUT", url: "/v1/settings", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 10. TOPICS — verify all expected topics exist
// ═══════════════════════════════════════════════════════════════════════

describe("topics.ts exports all expected commands and events", () => {
  it("COMMANDS has plan, subscription, quota, setting entries", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    expect(COMMANDS.planCreate).toBe("tenant.plan.create");
    expect(COMMANDS.planUpdate).toBe("tenant.plan.update");
    expect(COMMANDS.subscriptionCreate).toBe("tenant.subscription.create");
    expect(COMMANDS.subscriptionUpgrade).toBe("tenant.subscription.upgrade");
    expect(COMMANDS.subscriptionCancel).toBe("tenant.subscription.cancel");
    expect(COMMANDS.subscriptionRenew).toBe("tenant.subscription.renew");
    expect(COMMANDS.subscriptionSuspend).toBe("tenant.subscription.suspend");
    expect(COMMANDS.quotaSet).toBe("tenant.quota.set");
    expect(COMMANDS.quotaIncrement).toBe("tenant.quota.increment");
    expect(COMMANDS.settingUpsert).toBe("tenant.setting.upsert");
    expect(COMMANDS.settingDelete).toBe("tenant.setting.delete");
  });

  it("EVENTS has plan, subscription, quota, setting entries", async () => {
    const { EVENTS } = await import("../src/topics.js");
    expect(EVENTS.planCreated).toBe("tenant.plan.created");
    expect(EVENTS.planUpdated).toBe("tenant.plan.updated");
    expect(EVENTS.subscriptionCreated).toBe("tenant.subscription.created");
    expect(EVENTS.subscriptionUpgraded).toBe("tenant.subscription.upgraded");
    expect(EVENTS.subscriptionCancelled).toBe("tenant.subscription.cancelled");
    expect(EVENTS.subscriptionRenewed).toBe("tenant.subscription.renewed");
    expect(EVENTS.subscriptionSuspended).toBe("tenant.subscription.suspended");
    expect(EVENTS.quotaSet).toBe("tenant.quota.set_done");
    expect(EVENTS.quotaIncremented).toBe("tenant.quota.incremented");
    expect(EVENTS.settingUpserted).toBe("tenant.setting.upserted");
    expect(EVENTS.settingDeleted).toBe("tenant.setting.deleted");
  });
});
