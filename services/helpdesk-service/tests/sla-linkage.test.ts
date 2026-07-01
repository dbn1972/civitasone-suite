/**
 * helpdesk-service — HD1 (SLA-breach sweeper) + HD2 (inbound linkage + assign).
 *
 * DB-backed: uses the live civitas_helpdesk (same conn the route tests use).
 * Each test seeds + cleans its own rows under dedicated tenant ids so runs are
 * isolated and repeatable.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { sweepSlaBreaches } from "../src/modules/tickets/sweeper.js";
import { registerTicketConsumers } from "../src/modules/tickets/consumer.js";
import { CONSUMES, COMMANDS } from "../src/topics.js";
import { MemoryQueue } from "@civitasone/queue";
import * as repo from "../src/modules/tickets/repo.js";

const { outboxMessages, processed } = outboxSchema;

const TENANT_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const TENANT_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const ALL_TENANTS = [TENANT_A, TENANT_B];

async function cleanup() {
  await db.delete(tickets).where(inArray(tickets.tenantId, ALL_TENANTS));
  await db.delete(outboxMessages).where(inArray(outboxMessages.tenantId, ALL_TENANTS));
}

/** Seed a ticket whose created_at is `daysAgo` in the past (to force SLA state). */
async function seedTicket(tenantId: string, daysAgo: number, priority = "High", overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await db.insert(tickets).values({
    id, tenantId, subject: `seed ${id}`, description: null,
    priority, status: "open", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    createdAt, updatedAt: createdAt,
    ...overrides,
  } as typeof tickets.$inferInsert);
  return id;
}

async function outboxFor(tenantId: string, ticketId: string) {
  const rows = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
  return rows.filter((r) => JSON.stringify(r.payload).includes(ticketId));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("HD1 — SLA-breach sweeper", () => {
  it("breach detection: High ticket >3d old is breached, fresh one is not", async () => {
    const breachedId = await seedTicket(TENANT_A, 5, "High");   // due at +3d → breached
    const freshId = await seedTicket(TENANT_A, 0, "High");      // due at +3d → within_sla

    const breachedRow = await repo.findRow(breachedId, TENANT_A);
    const freshRow = await repo.findRow(freshId, TENANT_A);
    expect(repo.computeSla(breachedRow!).slaStatus).toBe("breached");
    expect(repo.computeSla(freshRow!).slaStatus).toBe("within_sla");
  });

  it("sets the notified marker + enqueues escalation, notification.send, audit under one correlationId", async () => {
    const id = await seedTicket(TENANT_A, 5, "High");
    const n = await sweepSlaBreaches();
    expect(n).toBeGreaterThanOrEqual(1);

    const row = await repo.findRow(id, TENANT_A);
    expect(row!.slaBreachedNotifiedAt).not.toBeNull(); // (a) marker set

    const msgs = await outboxFor(TENANT_A, id); // (b) events enqueued
    const topics = msgs.map((m) => m.topic).sort();
    expect(topics).toContain("helpdesk.ticket.escalated");
    expect(topics).toContain("notification.send");
    expect(topics).toContain("audit.event.record");
    // all three share one correlationId
    const cids = new Set(msgs.map((m) => m.correlationId));
    expect(cids.size).toBe(1);
  });

  it("restart-safe idempotency: re-running the sweeper does NOT re-notify", async () => {
    const id = await seedTicket(TENANT_A, 5, "High");
    await sweepSlaBreaches();
    const before = (await outboxFor(TENANT_A, id)).length;
    const n2 = await sweepSlaBreaches();
    const after = (await outboxFor(TENANT_A, id)).length;
    expect(n2).toBe(0);
    expect(after).toBe(before); // no duplicate notify
  });

  it("at_risk stage fires once, then breach stage fires separately", async () => {
    // ~2.6d old High ticket: due at +3d → <24h left → at_risk
    const id = await seedTicket(TENANT_A, 2.6, "High");
    const a = await sweepSlaBreaches();
    expect(a).toBe(1);
    let row = await repo.findRow(id, TENANT_A);
    expect(row!.slaAtRiskNotifiedAt).not.toBeNull();
    expect(row!.slaBreachedNotifiedAt).toBeNull();

    // advance virtual now past the due date → breach stage fires (distinct marker)
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const b = await sweepSlaBreaches(future);
    expect(b).toBeGreaterThanOrEqual(1);
    row = await repo.findRow(id, TENANT_A);
    expect(row!.slaBreachedNotifiedAt).not.toBeNull();
  });

  it("tenant isolation: a breach in tenant A never marks tenant B's ticket", async () => {
    const idA = await seedTicket(TENANT_A, 5, "High");
    const idB = await seedTicket(TENANT_B, 0, "High"); // fresh, not breached
    await sweepSlaBreaches();
    const rowA = await repo.findRow(idA, TENANT_A);
    const rowB = await repo.findRow(idB, TENANT_B);
    expect(rowA!.slaBreachedNotifiedAt).not.toBeNull();
    expect(rowB!.slaBreachedNotifiedAt).toBeNull();
    expect(rowB!.slaAtRiskNotifiedAt).toBeNull();
  });
});

describe("HD2 — inbound linkage consumer (telephony.call.missed → ticket)", () => {
  function wired() {
    const q = new MemoryQueue();
    registerTicketConsumers(q);
    return q;
  }
  function missedCallMsg(tenantId: string, callId: string, messageId = randomUUID()) {
    return {
      messageId, type: CONSUMES.telephonyCallMissed, tenantId, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { callId, status: "missed", tenantId },
    };
  }

  it("opens a linked ticket for a missed call", async () => {
    const q = wired();
    const callId = randomUUID();
    await q.publish(CONSUMES.telephonyCallMissed, missedCallMsg(TENANT_A, callId));
    await new Promise((r) => setTimeout(r, 50));

    const row = await repo.findBySource(TENANT_A, "telephony", callId);
    expect(row).not.toBeNull();
    expect(row!.source).toBe("telephony");
    expect(row!.sourceRef).toBe(callId);
    expect(row!.status).toBe("open");
  });

  it("idempotent: redelivery of the same call event yields exactly one ticket", async () => {
    const q = wired();
    const callId = randomUUID();
    // two distinct deliveries (different messageId) of the same call
    await q.publish(CONSUMES.telephonyCallMissed, missedCallMsg(TENANT_A, callId));
    await new Promise((r) => setTimeout(r, 40));
    await q.publish(CONSUMES.telephonyCallMissed, missedCallMsg(TENANT_A, callId));
    await new Promise((r) => setTimeout(r, 40));

    const rows = await db.select().from(tickets).where(
      and(eq(tickets.tenantId, TENANT_A), eq(tickets.source, "telephony"), eq(tickets.sourceRef, callId)),
    );
    expect(rows.length).toBe(1);
  });

  it("tenant isolation: same callId in two tenants → two distinct tickets", async () => {
    const q = wired();
    const callId = randomUUID();
    await q.publish(CONSUMES.telephonyCallMissed, missedCallMsg(TENANT_A, callId));
    await q.publish(CONSUMES.telephonyCallMissed, missedCallMsg(TENANT_B, callId));
    await new Promise((r) => setTimeout(r, 60));
    const a = await repo.findBySource(TENANT_A, "telephony", callId);
    const b = await repo.findBySource(TENANT_B, "telephony", callId);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
  });
});

describe("HD2 — assignment consumer", () => {
  function wired() {
    const q = new MemoryQueue();
    registerTicketConsumers(q);
    return q;
  }
  it("assigns a ticket to an agent and moves it to assigned", async () => {
    const id = await seedTicket(TENANT_A, 0, "Medium");
    const agent = randomUUID();
    const q = wired();
    await q.publish(COMMANDS.assignTicket, {
      messageId: randomUUID(), type: COMMANDS.assignTicket, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, assigneeId: agent },
    });
    await new Promise((r) => setTimeout(r, 50));
    const row = await repo.findRow(id, TENANT_A);
    expect(row!.assigneeId).toBe(agent);
    expect(row!.status).toBe("assigned");
  });

  it("tenant isolation: cannot assign another tenant's ticket (audited, no change)", async () => {
    const id = await seedTicket(TENANT_A, 0, "Medium");
    const agent = randomUUID();
    const q = wired();
    // attacker in TENANT_B targets TENANT_A's ticket id
    await q.publish(COMMANDS.assignTicket, {
      messageId: randomUUID(), type: COMMANDS.assignTicket, tenantId: TENANT_B, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_B, assigneeId: agent },
    });
    await new Promise((r) => setTimeout(r, 50));
    const row = await repo.findRow(id, TENANT_A);
    expect(row!.assigneeId).toBeNull();
    expect(row!.status).toBe("open");
  });
});
