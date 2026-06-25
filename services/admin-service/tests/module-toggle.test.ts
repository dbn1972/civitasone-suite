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
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { adminModuleConfigs } from "../src/modules/config/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerConfigConsumers } from "../src/modules/config/consumer.js";

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

async function cleanup() {
  await db.delete(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, MODULE_KEY)));
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1));
  await db.delete(processed).where(eq(processed.messageId, MSG_1));
  await db.delete(processed).where(eq(processed.messageId, MSG_2));
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

  it("202 for a tenant_admin toggling a module in their own tenant", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/admin/tenant/modules/${MODULE_KEY}/toggle`, headers: bearer(["tenant_admin"], T1), payload: { enabled: false } });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("config consumer — module toggle (integration)", () => {
  it("upserts the module config + emits audit, and a second toggle flips it", async () => {
    const q = new MemoryQueue();
    registerConfigConsumers(q);
    await q.start();
    await q.publish("admin.module.toggle", {
      messageId: MSG_1, type: "admin.module.toggle", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-tog-1", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { tenantId: T1, moduleKey: MODULE_KEY, enabled: false },
    });
    await new Promise((r) => setTimeout(r, 500));

    let rows = await db.select().from(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, MODULE_KEY)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);

    const audit = await db.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T1), eq(outboxMessages.eventType, "audit.event.record")));
    expect(audit.map((r) => (r.payload as { action?: string }).action)).toContain("module_toggle");

    await q.publish("admin.module.toggle", {
      messageId: MSG_2, type: "admin.module.toggle", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-tog-2", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { tenantId: T1, moduleKey: MODULE_KEY, enabled: true },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    rows = await db.select().from(adminModuleConfigs).where(and(eq(adminModuleConfigs.tenantId, T1), eq(adminModuleConfigs.moduleKey, MODULE_KEY)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
  });
});
