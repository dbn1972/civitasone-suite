/**
 * Tenant-admin notification preference update: PATCH /notifications/prefs/:id.
 *
 * Route inject tests assert the authz boundary (401/403/404/202) and a consumer
 * integration test registers the real template consumer, publishes the
 * notification.prefs.update command, and asserts the pref row's channels are
 * mutated (tenant-scoped) + an audit.event.record lands in the outbox.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { notificationPrefs } from "../src/modules/templates/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerTemplateConsumers } from "../src/modules/templates/consumer.js";

const SECRET = process.env.JWT_SECRET as string;
const ACTOR = "11110000-0000-4000-8000-0000000000aa";
const T1 = "11111111-aaaa-4000-8000-000000000001";
const T2 = "22222222-bbbb-4000-8000-000000000002";
const USER = "33333333-cccc-4000-8000-000000000003";

const PREF_T1 = "44444444-1111-4000-8000-000000000001";
const PREF_T2 = "44444444-2222-4000-8000-000000000002";
const MSG_1 = "55555555-1111-4000-8000-000000000001";

function token(roles: string[], tid: string): string {
  return signToken({ sub: ACTOR, roles, tid } as never, SECRET);
}
const bearer = (roles: string[], tid: string) => ({ authorization: `Bearer ${token(roles, tid)}` });

async function seedPref(id: string, tenantId: string) {
  await db.insert(notificationPrefs).values({
    id, tenantId, userId: USER, eventType: "finance.payment.released",
    inApp: true, email: true, push: false, createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing();
}

async function cleanup() {
  await db.delete(notificationPrefs).where(eq(notificationPrefs.id, PREF_T1));
  await db.delete(notificationPrefs).where(eq(notificationPrefs.id, PREF_T2));
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1));
  await db.delete(processed).where(eq(processed.messageId, MSG_1));
}

beforeAll(async () => {
  await cleanup();
  await seedPref(PREF_T1, T1);
  await seedPref(PREF_T2, T2);
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("PATCH /notifications/prefs/:id — route authz (inject)", () => {
  it("401 without token", async () => {
    const app = await buildAppFresh();
    const res = await app.inject({ method: "PATCH", url: `/notifications/prefs/${PREF_T1}`, payload: { email: false } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin role", async () => {
    const app = await buildAppFresh();
    const res = await app.inject({ method: "PATCH", url: `/notifications/prefs/${PREF_T1}`, headers: bearer(["notification_user"], T1), payload: { email: false } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an admin from a different tenant (cross-tenant hidden)", async () => {
    const app = await buildAppFresh();
    const res = await app.inject({ method: "PATCH", url: `/notifications/prefs/${PREF_T1}`, headers: bearer(["tenant_admin"], T2), payload: { email: false } });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for an empty body (no channel provided)", async () => {
    const app = await buildAppFresh();
    const res = await app.inject({ method: "PATCH", url: `/notifications/prefs/${PREF_T1}`, headers: bearer(["tenant_admin"], T1), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("202 for a tenant_admin updating a pref in their tenant", async () => {
    const app = await buildAppFresh();
    const res = await app.inject({ method: "PATCH", url: `/notifications/prefs/${PREF_T1}`, headers: bearer(["tenant_admin"], T1), payload: { email: false, inApp: false } });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("template consumer — prefs update (integration)", () => {
  it("mutates the pref row channels (tenant-scoped) + emits audit", async () => {
    const q = new MemoryQueue();
    registerTemplateConsumers(q);
    await q.start();
    await q.publish("notification.prefs.update", {
      messageId: MSG_1, type: "notification.prefs.update", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-pref-1", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { id: MSG_1, tenantId: T1, prefId: PREF_T1, email: false, inApp: false },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const t1 = await db.select().from(notificationPrefs).where(eq(notificationPrefs.id, PREF_T1));
    expect(t1[0]?.email).toBe(false);
    expect(t1[0]?.inApp).toBe(false);

    // the other tenant's pref (same shape) must be untouched
    const t2 = await db.select().from(notificationPrefs).where(eq(notificationPrefs.id, PREF_T2));
    expect(t2[0]?.email).toBe(true);

    const audit = await db.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T1), eq(outboxMessages.eventType, "audit.event.record")));
    expect(audit.map((r) => (r.payload as { action?: string }).action)).toContain("update_prefs");
  });
});

async function buildAppFresh() {
  const { buildApp } = await import("../src/app.js");
  return buildApp();
}
