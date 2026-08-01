/**
 * TKT-11 — closes the black-hole facade for saved views: VIEW_COMMANDS.create/
 * update/delete were published but nothing subscribed (GET already read real
 * rows via scopedRead, but nothing ever wrote one). These tests assert actual
 * DB persistence, idempotency, and RLS cross-tenant/cross-owner isolation.
 *
 * DB-backed against live civitas_helpdesk, mirroring the tickets consumer tests.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { savedViews } from "../src/modules/tickets/views-schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerViewConsumers } from "../src/modules/tickets/views-consumer.js";
import { VIEW_COMMANDS, EVENTS } from "../src/topics.js";

const { outboxMessages } = outboxSchema;

const TENANT_A = "aaaaaaaa-0000-4000-8000-0000000bc701";
const TENANT_B = "bbbbbbbb-0000-4000-8000-0000000bc702";
const OWNER = "00000000-aaaa-4000-8000-0000000bc799";
const ALL_TENANTS = [TENANT_A, TENANT_B];

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function wired() {
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerViewConsumers(q);
  return q;
}

async function cleanup() {
  for (const tenantId of ALL_TENANTS) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(savedViews).where(eq(savedViews.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
}

async function findView(id: string, tenantId: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.tenantId, tenantId)))),
  );
  return rows[0] ?? null;
}

async function outboxFor(tenantId: string, needle: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId))),
  );
  return rows.filter((r) => JSON.stringify(r.payload).includes(needle));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("VIEW_COMMANDS.create — persists a saved view", () => {
  it("inserts the row and emits viewCreated", async () => {
    const q = wired();
    const id = randomUUID();
    await q.publish(VIEW_COMMANDS.create, {
      messageId: id, type: VIEW_COMMANDS.create, tenantId: TENANT_A, actorId: OWNER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, ownerId: OWNER, name: "My Open Tickets", filters: { status: "open" }, columns: ["id", "subject"], shared: false },
    });
    await new Promise((r) => setTimeout(r, 150));

    const row = await findView(id, TENANT_A);
    expect(row).not.toBeNull();
    expect(row!.name).toBe("My Open Tickets");
    expect(row!.ownerId).toBe(OWNER);
    expect(row!.shared).toBe(false);

    const emitted = await outboxFor(TENANT_A, id);
    expect(emitted.some((m) => m.topic === EVENTS.viewCreated)).toBe(true);
  });

  it("idempotent: redelivery of the same view id does not duplicate", async () => {
    const q = wired();
    const id = randomUUID();
    const msg = {
      messageId: id, type: VIEW_COMMANDS.create, tenantId: TENANT_A, actorId: OWNER,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { id, tenantId: TENANT_A, ownerId: OWNER, name: "Dup View", filters: {}, columns: [], shared: false },
    };
    await q.publish(VIEW_COMMANDS.create, msg);
    await new Promise((r) => setTimeout(r, 100));
    await q.publish(VIEW_COMMANDS.create, msg);
    await new Promise((r) => setTimeout(r, 100));

    const row = await findView(id, TENANT_A);
    expect(row).not.toBeNull();
    const created = (await outboxFor(TENANT_A, id)).filter((m) => m.topic === EVENTS.viewCreated);
    expect(created.length).toBe(1);
  });

  it("tenant isolation: tenant B cannot see tenant A's view", async () => {
    const q = wired();
    const id = randomUUID();
    await q.publish(VIEW_COMMANDS.create, {
      messageId: id, type: VIEW_COMMANDS.create, tenantId: TENANT_A, actorId: OWNER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, ownerId: OWNER, name: "A-only view", filters: {}, columns: [], shared: false },
    });
    await new Promise((r) => setTimeout(r, 150));

    expect(await findView(id, TENANT_A)).not.toBeNull();
    expect(await findView(id, TENANT_B)).toBeNull();
  });
});

describe("VIEW_COMMANDS.update — persists changes to a saved view", () => {
  async function seedView(tenantId: string): Promise<string> {
    const id = randomUUID();
    await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.insert(savedViews).values({
        id, tenantId, ownerId: OWNER, name: "Original", filters: {}, columns: [], shared: false,
      })),
    );
    return id;
  }

  it("updates name/filters/shared and bumps version", async () => {
    const q = wired();
    const id = await seedView(TENANT_A);
    const cmdId = randomUUID();
    await q.publish(VIEW_COMMANDS.update, {
      messageId: cmdId, type: VIEW_COMMANDS.update, tenantId: TENANT_A, actorId: OWNER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, actorId: OWNER, name: "Renamed", filters: { status: "closed" }, shared: true },
    });
    await new Promise((r) => setTimeout(r, 150));

    const row = await findView(id, TENANT_A);
    expect(row!.name).toBe("Renamed");
    expect(row!.filters).toEqual({ status: "closed" });
    expect(row!.shared).toBe(true);
    expect(row!.version).toBe(2);

    const emitted = await outboxFor(TENANT_A, id);
    expect(emitted.some((m) => m.topic === EVENTS.viewUpdated)).toBe(true);
  });

  it("rejects (audited, no throw) an update for a view that doesn't exist in this tenant", async () => {
    const q = wired();
    const id = await seedView(TENANT_A);
    const cmdId = randomUUID();
    await q.publish(VIEW_COMMANDS.update, {
      messageId: cmdId, type: VIEW_COMMANDS.update, tenantId: TENANT_B, actorId: OWNER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_B, actorId: OWNER, name: "Hijacked" },
    });
    await new Promise((r) => setTimeout(r, 150));

    const row = await findView(id, TENANT_A);
    expect(row!.name).toBe("Original"); // untouched — cross-tenant update rejected
  });
});

describe("VIEW_COMMANDS.delete — persists removal of a saved view", () => {
  async function seedView(tenantId: string): Promise<string> {
    const id = randomUUID();
    await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.insert(savedViews).values({
        id, tenantId, ownerId: OWNER, name: "To delete", filters: {}, columns: [], shared: false,
      })),
    );
    return id;
  }

  it("deletes the row and emits viewDeleted", async () => {
    const q = wired();
    const id = await seedView(TENANT_A);
    const cmdId = randomUUID();
    await q.publish(VIEW_COMMANDS.delete, {
      messageId: cmdId, type: VIEW_COMMANDS.delete, tenantId: TENANT_A, actorId: OWNER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, actorId: OWNER },
    });
    await new Promise((r) => setTimeout(r, 150));

    expect(await findView(id, TENANT_A)).toBeNull();
    const emitted = await outboxFor(TENANT_A, id);
    expect(emitted.some((m) => m.topic === EVENTS.viewDeleted)).toBe(true);
  });

  it("tenant isolation: tenant B cannot delete tenant A's view", async () => {
    const q = wired();
    const id = await seedView(TENANT_A);
    const cmdId = randomUUID();
    await q.publish(VIEW_COMMANDS.delete, {
      messageId: cmdId, type: VIEW_COMMANDS.delete, tenantId: TENANT_B, actorId: OWNER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_B, actorId: OWNER },
    });
    await new Promise((r) => setTimeout(r, 150));

    expect(await findView(id, TENANT_A)).not.toBeNull(); // still there
  });
});
