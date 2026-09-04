/**
 * G7 — Channel Quota + Usage Metering Tests
 *
 * Tests:
 * 1. Quota enforcement: 429 when exhausted
 * 2. Route tests: GET/PUT quota CRUD
 * 3. Auth checks: 401/403
 * 4. Guard logic: checkQuota behavior
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000002";
const ACTOR = "cccccccc-3333-4000-8000-000000000002";

function adminToken(tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["tenant_admin"], sid: "sess-quota" }, SECRET);
}

function userToken(tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["notification_user"], sid: "sess-quota" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ---------- Route tests: quota CRUD ----------

describe("Quota routes", () => {
  it("GET /notifications/channels/quotas — returns quotas list", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/channels/quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("GET /notifications/channels/quotas — 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/channels/quotas",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /notifications/channel-quotas — sets a quota (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "sms",
        monthlyLimit: 10000,
        periodStart: "2025-01-01",
        periodEnd: "2025-01-31",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.channel).toBe("sms");
    expect(json.data.monthlyLimit).toBeDefined();
  });

  it("POST /notifications/channel-quotas — 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: {
        channel: "sms",
        monthlyLimit: 10000,
        periodStart: "2025-01-01",
        periodEnd: "2025-01-31",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("PUT /notifications/channels/quotas — sets a quota (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/notifications/channels/quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "email",
        monthlyLimit: 50000,
        periodStart: "2025-02-01",
        periodEnd: "2025-02-28",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.channel).toBe("email");
    expect(json.data.monthlyLimit).toBeDefined();
  });

  it("PUT /notifications/channels/quotas — 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/notifications/channels/quotas",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: {
        channel: "sms",
        monthlyLimit: 10000,
        periodStart: "2025-01-01",
        periodEnd: "2025-01-31",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /notifications/channel-quotas — validates body (bad channel)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "telegram",
        monthlyLimit: 10000,
        periodStart: "2025-01-01",
        periodEnd: "2025-01-31",
      },
    });
    await app.close();
    // Zod validation failure → 400
    expect(res.statusCode).toBe(400);
  });

  it("POST /notifications/channel-quotas — validates body (bad date format)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "sms",
        monthlyLimit: 10000,
        periodStart: "01/01/2025",
        periodEnd: "01/31/2025",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ---------- Quota guard logic ----------

describe("checkQuota — guard logic", () => {
  it("passes when no quota is configured", async () => {
    const { checkQuota } = await import("../src/modules/channels/quota-guard.js");
    const { db } = await import("../src/shared/db.js");
    // Non-existent tenant → no quota row → allowed. checkQuota now reads
    // through the caller's already-open tx (see task_477fafd4 -- routes
    // checkQuota/checkDlt onto the outer tx instead of scopedRead's own
    // nested transaction, which used to deadlock the pool).
    const result = await db.transaction((tx) => checkQuota(tx, "00000000-0000-4000-8000-999999999999", "email"));
    expect(result.passed).toBe(true);
  });
});

// ---------- Quota validators ----------

describe("upsertQuotaBody validator", () => {
  it("accepts valid body", async () => {
    const { upsertQuotaBody } = await import("../src/modules/channels/quota-validators.js");
    const result = upsertQuotaBody.safeParse({
      channel: "sms",
      monthlyLimit: 5000,
      periodStart: "2025-07-01",
      periodEnd: "2025-07-31",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid channel", async () => {
    const { upsertQuotaBody } = await import("../src/modules/channels/quota-validators.js");
    const result = upsertQuotaBody.safeParse({
      channel: "pigeon",
      monthlyLimit: 5000,
      periodStart: "2025-07-01",
      periodEnd: "2025-07-31",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative monthlyLimit", async () => {
    const { upsertQuotaBody } = await import("../src/modules/channels/quota-validators.js");
    const result = upsertQuotaBody.safeParse({
      channel: "email",
      monthlyLimit: -100,
      periodStart: "2025-07-01",
      periodEnd: "2025-07-31",
    });
    expect(result.success).toBe(false);
  });

  it("rejects bad date format", async () => {
    const { upsertQuotaBody } = await import("../src/modules/channels/quota-validators.js");
    const result = upsertQuotaBody.safeParse({
      channel: "email",
      monthlyLimit: 100,
      periodStart: "not-a-date",
      periodEnd: "2025-07-31",
    });
    expect(result.success).toBe(false);
  });
});

// ---------- Quota increment on delivery ----------

describe("quotaRepo.incrementUsed", () => {
  it("does not throw when no matching quota row exists", async () => {
    const { incrementUsed } = await import("../src/modules/channels/quota-repo.js");
    const { db } = await import("../src/shared/db.js");
    // Should be a no-op: no matching row to increment
    await expect(
      db.transaction(async (tx) => {
        await incrementUsed(tx, "00000000-0000-4000-8000-999999999999", "push", "2025-07-15");
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------- Usage route ----------

describe("GET /notifications/channel-quotas/usage — usage summary", () => {
  it("200 returns current period usage summary", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/channel-quotas/usage",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/channel-quotas/usage",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ---------- Unlimited quota ----------

describe("checkQuota — unlimited status always passes", () => {
  it("allows send when status is unlimited", async () => {
    const { checkQuota } = await import("../src/modules/channels/quota-guard.js");
    const { runWithTenant } = await import("@civitasone/db");
    // Create quota with unlimited status via route (RLS-safe)
    const app = await buildApp();
    const today = new Date().toISOString().slice(0, 10);
    const periodStart = today.slice(0, 8) + "01";
    const periodEnd = today.slice(0, 8) + "28";
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "push",
        monthlyLimit: 1,
        periodStart,
        periodEnd,
        status: "unlimited",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);

    const { db } = await import("../src/shared/db.js");
    // checkQuota now reads through the caller's tx (task_477fafd4), which
    // still needs to run inside tenant context for RLS.
    const result = await runWithTenant(TENANT, () =>
      db.transaction((tx) => checkQuota(tx, TENANT, "push")),
    ) as Awaited<ReturnType<typeof checkQuota>>;
    // Unlimited → always passes regardless of usage
    expect(result.passed).toBe(true);
  });
});

// ---------- Exhausted quota ----------

describe("checkQuota — exhausted when used >= limit", () => {
  it("rejects when quota is exhausted", async () => {
    const { checkQuota } = await import("../src/modules/channels/quota-guard.js");
    const { db } = await import("../src/shared/db.js");
    const { channelQuotas } = await import("../src/modules/channels/quota-schema.js");
    const { eq } = await import("drizzle-orm");
    const { runWithTenant } = await import("@civitasone/db");
    // Create a quota via route first, then manually set used = monthlyLimit in DB
    const app = await buildApp();
    const today = new Date().toISOString().slice(0, 10);
    const periodStart = today.slice(0, 8) + "01";
    const periodEnd = today.slice(0, 8) + "28";
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "whatsapp",
        monthlyLimit: 100,
        periodStart,
        periodEnd,
        status: "active",
      },
    });
    await app.close();
    expect(createRes.statusCode).toBe(200);
    const quotaId = createRes.json().data.id;

    // Update used count within tenant context + transaction so RLS GUC is set
    await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.update(channelQuotas)
          .set({ used: BigInt(100) })
          .where(eq(channelQuotas.id, quotaId));
      }),
    );

    // checkQuota now reads through the caller's tx (task_477fafd4), which
    // still needs to run inside tenant context for RLS.
    const result = await runWithTenant(TENANT, () =>
      db.transaction((tx) => checkQuota(tx, TENANT, "whatsapp")),
    ) as Awaited<ReturnType<typeof checkQuota>>;
    expect(result.passed).toBe(false);
    expect(result.used).toBe(BigInt(100));
    expect(result.limit).toBe(BigInt(100));
  });
});

// ---------- POST with status ----------

describe("POST /notifications/channel-quotas — with status field", () => {
  it("creates quota with unlimited status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "push",
        monthlyLimit: 999999,
        periodStart: "2025-03-01",
        periodEnd: "2025-03-31",
        status: "unlimited",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("unlimited");
  });

  it("400 for invalid status value", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channel-quotas",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        channel: "sms",
        monthlyLimit: 10000,
        periodStart: "2025-03-01",
        periodEnd: "2025-03-31",
        status: "invalid_status",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ---------- Usage event topic ----------

describe("notification.channel.usage topic — billing integration", () => {
  it("topic value exists in EVENTS", async () => {
    const { EVENTS } = await import("../src/topics.js");
    expect(EVENTS.channelUsage).toBe("notification.channel.usage");
  });

  it("command value exists in COMMANDS", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    expect(COMMANDS.recordChannelUsage).toBe("notification.channel.usage");
  });
});
