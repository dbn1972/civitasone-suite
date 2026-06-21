import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { adminTenants } from "../src/modules/tenants/schema.js";
import { adminBreakGlassLog } from "../src/modules/support/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenants/consumer.js";
import { registerSupportConsumers } from "../src/modules/support/consumer.js";
import { resolveFeatureFlag } from "../src/modules/config/domain.js";
import { aggregateHealth } from "../src/modules/health/domain.js";
import { breakGlassExpiresAt, BREAK_GLASS_TTL_MS } from "../src/modules/support/domain.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const T1_ID = "11111111-aaaa-4000-8000-000000000001";
const MSG_1 = "aaaaaaaa-1111-4000-8000-000000000001";
const BG_ID = "bbbbbbbb-2222-4000-8000-000000000002";
const TICKET = "cccccccc-3333-4000-8000-000000000003";

async function wipeTenant() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
  await db.delete(adminTenants).where(eq(adminTenants.id, T1_ID));
  await db.delete(processed).where(eq(processed.messageId, MSG_1));
}

describe("config domain — feature flag resolution (pure)", () => {
  it("tenant override wins over global=false", () => {
    expect(resolveFeatureFlag({ globalEnabled: false, tenantOverride: true })).toBe(true);
  });
});

describe("health domain — aggregate (pure)", () => {
  it("2 ok + 1 down → degraded", () => {
    const result = aggregateHealth([
      { service: "a", status: "ok" },
      { service: "b", status: "ok" },
      { service: "c", status: "down", httpStatus: 503 },
    ]);
    expect(result.status).toBe("degraded");
  });
});

describe("support domain — break-glass expiry (pure)", () => {
  it("opened_at + 2h = expires_at", () => {
    const opened = new Date("2025-01-01T10:00:00Z");
    const expires = breakGlassExpiresAt(opened);
    expect(expires.getTime() - opened.getTime()).toBe(BREAK_GLASS_TTL_MS);
  });
});

describe("tenant consumer — CQRS (integration)", () => {
  beforeAll(async () => { await wipeTenant(); });
  afterAll(async () => { await wipeTenant(); });

  it("admin.tenant.create writes admin_tenants + outbox", async () => {
    const q = new MemoryQueue();
    registerTenantConsumers(q);
    await q.start();
    await q.publish("admin.tenant.create", {
      messageId: MSG_1, type: "admin.tenant.create", tenantId: T1_ID,
      actorId: ACTOR, correlationId: "corr-admin-1", schemaVersion: "1.0",
      payload: {
        id: T1_ID, tenantId: T1_ID, name: "Admin Test", domain: "admin-test.example",
        edition: "psu", status: "draft", region: "ap-south-1", residency: "IN", settings: {}, version: 1,
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(adminTenants).where(eq(adminTenants.id, T1_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.edition).toBe("psu");

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
    expect(outbox.map((r) => r.eventType)).toContain("admin.tenant.created");
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});

describe("admin-service route auth (inject)", () => {
  it("GET /v1/admin/api-keys without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/admin/breakglass without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/breakglass" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("break-glass consumer — audit emission (integration)", () => {
  beforeAll(async () => {
    await db.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_ID));
    await db.delete(processed).where(eq(processed.messageId, BG_ID));
  });
  afterAll(async () => {
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
    await db.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_ID));
    await sqlClient.end();
  });

  it("open emits audit.event.record", async () => {
    const q = new MemoryQueue();
    registerSupportConsumers(q);
    await q.start();
    await q.publish("admin.breakglass.open", {
      messageId: BG_ID, type: "admin.breakglass.open", tenantId: T1_ID,
      actorId: ACTOR, correlationId: "corr-bg-1", schemaVersion: "1.0",
      payload: { id: BG_ID, tenantId: T1_ID, ticketId: TICKET, reason: "SRE investigation required", actorId: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ticketId).toBe(TICKET);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
    expect(outbox.map((r) => r.eventType)).toContain("admin.breakglass.opened");
  });
});
