/**
 * Tenant-admin module toggle: POST /v1/admin/tenant/modules/:key/toggle.
 *
 * Route inject tests assert the authz boundary (401/403/202); a consumer
 * integration test registers the real config consumer, publishes the
 * admin.module.toggle command, and asserts the module row is upserted + an
 * audit.event.record lands in the outbox (and that a second toggle flips it).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { adminModuleConfigs } from "../src/modules/config/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerConfigConsumers } from "../src/modules/config/consumer.js";
import { drainOrFail } from "../../../vitest.drain";

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the `createQueue()`
 * factory) does NOT auto-wrap subscribed handlers with `withTenantConsumer`,
 * so consumer writes/reads run with no RLS GUC set. Mirror production's
 * `createQueue()` decoration here (see admin.test.ts / estab-service tests).
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const SECRET = process.env.JWT_SECRET as string;
const ACTOR = "e0000000-0000-4000-8000-0000000000aa";
const T1 = "e1111111-1111-4000-8000-000000000001";
const MODULE_KEY = "hrms";
const MSG_1 = "f1111111-1111-4000-8000-000000000001";
const MSG_2 = "f1111111-1111-4000-8000-000000000002";

function token(roles: string[], tid: string): string {
  return signToken({ sub: ACTOR, roles, tid } as never, SECRET);
}
const bearer = (roles: string[], tid: string) => ({ authorization: `Bearer ${token(roles, tid)}` });

// Test-harness fix: bare db.delete() outside db.transaction() runs with no RLS
// GUC set (wrapWithTenantGuc only injects app.tenant_id inside transactions).
async function cleanup() {
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    await tx.delete(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, MODULE_KEY)));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1));
    await tx.delete(processed).where(eq(processed.messageId, MSG_1));
    await tx.delete(processed).where(eq(processed.messageId, MSG_2));
  }));
}

// GAP-TENANT-ADMIN-SETTINGS-07: the tenant route only toggles modules the tenant
// is provisioned with, so the route tests seed a row first.
async function seedModule(enabled = true) {
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    await tx.delete(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, MODULE_KEY)));
    await tx.insert(adminModuleConfigs).values({ tenantId: T1, moduleKey: MODULE_KEY, enabled, createdBy: ACTOR, updatedBy: ACTOR });
  }));
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("POST /v1/admin/tenant/modules/:key/toggle — route authz (inject)", () => {
  it("401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/admin/tenant/modules/${MODULE_KEY}/toggle`, payload: { enabled: false } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin role", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/admin/tenant/modules/${MODULE_KEY}/toggle`, headers: bearer(["employee"], T1), payload: { enabled: false } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when body is missing the enabled flag", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/admin/tenant/modules/${MODULE_KEY}/toggle`, headers: bearer(["tenant_admin"], T1), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for a tenant_admin toggling a module the tenant is not provisioned with (GAP-TENANT-ADMIN-SETTINGS-07)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/admin/tenant/modules/not-a-real-module/toggle", headers: bearer(["tenant_admin"], T1), payload: { enabled: true } });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("MODULE_NOT_PROVISIONED");
    const rows = await runWithTenant(T1, () => db.transaction((tx) =>
      tx.select().from(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, "not-a-real-module")))));
    expect(rows).toHaveLength(0);
  });

  it("GET ?detail=1 lists enabled AND disabled modules with real flags (GAP-TENANT-ADMIN-SETTINGS-01)", async () => {
    await seedModule(false);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenant/modules?detail=1", headers: bearer(["tenant_admin"], T1) });
    const legacy = await app.inject({ method: "GET", url: "/v1/admin/tenant/modules", headers: bearer(["tenant_admin"], T1) });
    await app.close();
    expect(res.statusCode).toBe(200);
    const row = (res.json().data as Array<{ moduleKey: string; enabled: boolean; moduleName: string }>).find((m) => m.moduleKey === MODULE_KEY);
    expect(row).toMatchObject({ moduleKey: MODULE_KEY, enabled: false, moduleName: "Hrms" });
    // Legacy readers still get the enabled-only {name} list: the disabled module is absent.
    expect((legacy.json().data as Array<{ name: string }>).some((m) => m.name === MODULE_KEY)).toBe(false);
  });

  it("202 for a tenant_admin toggling a module in their own tenant", async () => {
    await seedModule(true);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/admin/tenant/modules/${MODULE_KEY}/toggle`, headers: bearer(["tenant_admin"], T1), payload: { enabled: false } });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("config consumer — module toggle (integration)", () => {
  it("upserts the module config + emits audit, and a second toggle flips it", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerConfigConsumers(q);
    await q.start();
    await q.publish("admin.module.toggle", {
      messageId: MSG_1, type: "admin.module.toggle", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-tog-1", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { tenantId: T1, moduleKey: MODULE_KEY, enabled: false },
    });
    await drainOrFail(q);

    let [rows, audit] = await runWithTenant(T1, () =>
      db.transaction((tx) => Promise.all([
        tx.select().from(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, MODULE_KEY))),
        tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T1), eq(outboxMessages.eventType, "audit.event.record"))),
      ])),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
    expect(audit.map((r) => (r.payload as { action?: string }).action)).toContain("module_toggle");

    await q.publish("admin.module.toggle", {
      messageId: MSG_2, type: "admin.module.toggle", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-tog-2", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { tenantId: T1, moduleKey: MODULE_KEY, enabled: true },
    });
    await drainOrFail(q);
    await q.stop();

    rows = await runWithTenant(T1, () =>
      db.transaction((tx) => tx.select().from(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, MODULE_KEY)))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
  });

  it("writes the audited reason into the module_toggle audit event (GAP-TENANT-ADMIN-SETTINGS-02)", async () => {
    const MSG_3 = "f1111111-1111-4000-8000-000000000003";
    await runWithTenant(T1, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1));
      await tx.delete(processed).where(eq(processed.messageId, MSG_3));
    }));

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerConfigConsumers(q);
    await q.start();
    await q.publish("admin.module.toggle", {
      messageId: MSG_3, type: "admin.module.toggle", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-tog-3", schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: { tenantId: T1, moduleKey: MODULE_KEY, enabled: false, reason: "Finance disabled pending audit" },
    });
    await drainOrFail(q);
    await q.stop();

    const audit = await runWithTenant(T1, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T1), eq(outboxMessages.eventType, "audit.event.record")))));
    const toggleAudit = audit.find((r) => (r.payload as { action?: string }).action === "module_toggle");
    expect(toggleAudit).toBeDefined();
    expect((toggleAudit!.payload as { reason?: string }).reason).toBe("Finance disabled pending audit");
    expect((toggleAudit!.payload as { enabled?: boolean }).enabled).toBe(false);
    expect((toggleAudit!.payload as { moduleKey?: string }).moduleKey).toBe(MODULE_KEY);

    await runWithTenant(T1, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(eq(processed.messageId, MSG_3));
    }));
  });
});
