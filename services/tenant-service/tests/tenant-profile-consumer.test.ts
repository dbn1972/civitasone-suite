/**
 * Tenant-type profile switch, S1: the create and onboard consumers carry the profile into the row and the events.
 * Same capturing-queue pattern as onboard-isolation-event.property.test.ts (real Postgres, tenant-scoped).
 */
import { describe, it, expect, afterAll } from "vitest";
import type { CommandEnvelope, Handler, Queue, QueueDriver } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants } from "../src/modules/tenant/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenant/consumer.js";
import { EVENTS } from "../src/topics.js";

const ACTOR = "00000000-bbbb-4000-8000-000000000002";

class CapturingQueue implements Queue {
  private handlers = new Map<string, Handler[]>();
  subscribe<T>(topic: string, handler: Handler<T>): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as Handler);
    this.handlers.set(topic, list);
  }
  async publish<T>(topic: string, input: { messageId: string } & Partial<CommandEnvelope<T>>): Promise<string> {
    const msg = input as CommandEnvelope<T>;
    for (const h of this.handlers.get(topic) ?? []) await runWithTenant(msg.tenantId, () => h(msg));
    return msg.messageId;
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
  async healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }> { return { healthy: true, driver: "memory" }; }
}

const made: Array<{ tenantId: string; ids: string[] }> = [];
afterAll(async () => {
  for (const { tenantId, ids } of made) {
    await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      await tx.delete(tenants).where(eq(tenants.id, tenantId));
    }));
    for (const id of ids) await db.delete(processed).where(eq(processed.messageId, id));
  }
  await sqlClient.end();
});

async function onboard(edition: string, profileCode: string | undefined) {
  const tenantId = randomUUID(); const createId = randomUUID(); const onboardId = randomUUID();
  made.push({ tenantId, ids: [createId, onboardId] });
  const q = new CapturingQueue(); registerTenantConsumers(q); await q.start();
  const base = { tenantId, actorId: ACTOR, correlationId: `c-${createId}`, schemaVersion: "1.0" };
  await q.publish("tenant.tenant.create", {
    ...base, messageId: createId, type: "tenant.tenant.create",
    payload: {
      id: tenantId, tenantId, name: "Office of the Tehsildar, Sohna", domain: `t-${tenantId.slice(0, 8)}.haryana.gov.in`, edition,
      ...(profileCode ? { profileCode } : {}), status: "draft", region: "ap-south-1", residency: "IN", settings: {}, version: 1,
    },
  });
  await q.publish("tenant.tenant.onboard", {
    ...base, messageId: onboardId, type: "tenant.tenant.onboard",
    payload: { tenantId, adminEmail: "tehsildar.sohna@haryana.gov.in", adminName: "Sunita Devi", edition, ...(profileCode ? { profileCode } : {}) },
  });
  const rows = await runWithTenant(tenantId, () => db.transaction(async (tx) => ({
    row: (await tx.select().from(tenants).where(eq(tenants.id, tenantId)))[0],
    events: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId)),
  })));
  const ev = (type: string) => rows.events.find((e) => e.eventType === type)?.payload as Record<string, unknown> | undefined;
  return { row: rows.row!, created: ev(EVENTS.tenantCreated), onboarded: ev(EVENTS.tenantOnboarded) };
}

describe("create + onboard consumers carry the profile", () => {
  it("a govt tenant onboarded the old way (no profile) is govt_dept in the row and on both events", async () => {
    const r = await onboard("govt", undefined);
    expect(r.row.profileCode).toBe("govt_dept");
    expect(r.created).toMatchObject({ edition: "govt", profileCode: "govt_dept", profileVersion: "1" });
    expect(r.onboarded).toMatchObject({ edition: "govt", profileCode: "govt_dept", profileVersion: "1" });
  });
  it("a govt_small_office tenant keeps its profile through create and onboard", async () => {
    const r = await onboard("govt", "govt_small_office");
    expect(r.row.profileCode).toBe("govt_small_office");
    expect(r.created).toMatchObject({ profileCode: "govt_small_office" });
    expect(r.onboarded).toMatchObject({ edition: "govt", profileCode: "govt_small_office" });
  });
  it("a PSU tenant is psu (legacy behaviour) on the events", async () => {
    const r = await onboard("psu", undefined);
    expect(r.onboarded).toMatchObject({ edition: "psu", profileCode: "psu" });
  });
});
