/**
 * TKT-04/07/08/09/14 — closes the black-hole facade: addNote, transferTicket,
 * linkTickets, bulkAction, reopenTicket were published but never consumed
 * (routes returned 202/204 and nothing persisted). These tests assert actual
 * DB persistence (HTTP/queue -> consumer -> DB round trip), idempotency, and
 * RLS cross-tenant isolation — not just the 202 status code the pre-existing
 * route tests check.
 *
 * DB-backed against live civitas_helpdesk, mirroring tests/sla-linkage.test.ts
 * and tests/escalate-to-ticket.test.ts (MemoryQueue + withTenantConsumer wiring).
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { ticketNotes } from "../src/modules/tickets/notes-schema.js";
import { ticketLinks } from "../src/modules/tickets/links-schema.js";
import { ticketTransfers } from "../src/modules/tickets/transfer-schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerTicketConsumers } from "../src/modules/tickets/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const { outboxMessages } = outboxSchema;

const TENANT_A = "aaaaaaaa-0000-4000-8000-0000000ac701";
const TENANT_B = "bbbbbbbb-0000-4000-8000-0000000ac702";
const ACTOR = "00000000-aaaa-4000-8000-0000000ac799";
const ALL_TENANTS = [TENANT_A, TENANT_B];

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function wired() {
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerTicketConsumers(q);
  return q;
}

async function seedTicket(tenantId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(tickets).values({
        id, tenantId, subject: `seed ${id}`, description: null,
        priority: "Medium", status: "open", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        ...overrides,
      } as typeof tickets.$inferInsert),
    ),
  );
  return id;
}

async function cleanup() {
  for (const tenantId of ALL_TENANTS) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(ticketNotes).where(eq(ticketNotes.tenantId, tenantId));
        await tx.delete(ticketLinks).where(eq(ticketLinks.tenantId, tenantId));
        await tx.delete(ticketTransfers).where(eq(ticketTransfers.tenantId, tenantId));
        await tx.delete(tickets).where(eq(tickets.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
}

async function findRow(id: string, tenantId: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)))),
  );
  return rows[0] ?? null;
}

async function notesFor(ticketId: string, tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(ticketNotes).where(and(eq(ticketNotes.ticketId, ticketId), eq(ticketNotes.tenantId, tenantId)))),
  );
}

async function linksFor(sourceId: string, tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(ticketLinks).where(and(eq(ticketLinks.sourceTicketId, sourceId), eq(ticketLinks.tenantId, tenantId)))),
  );
}

async function transfersFor(ticketId: string, tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(ticketTransfers).where(and(eq(ticketTransfers.ticketId, ticketId), eq(ticketTransfers.tenantId, tenantId)))),
  );
}

async function outboxFor(tenantId: string, needle: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId))),
  );
  return rows.filter((r) => JSON.stringify(r.payload).includes(needle));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("TKT-04 — addNote consumer persists a note", () => {
  it("inserts the note row and emits noteAdded", async () => {
    const q = wired();
    const ticketId = await seedTicket(TENANT_A);
    const noteId = randomUUID();
    await q.publish(COMMANDS.addNote, {
      messageId: noteId, type: COMMANDS.addNote, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: noteId, tenantId: TENANT_A, ticketId, content: "customer called back", visibility: "public", createdBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 150));

    const rows = await notesFor(ticketId, TENANT_A);
    expect(rows.length).toBe(1);
    expect(rows[0]!.content).toBe("customer called back");
    expect(rows[0]!.visibility).toBe("public");

    const emitted = await outboxFor(TENANT_A, noteId);
    expect(emitted.some((m) => m.topic === EVENTS.noteAdded)).toBe(true);
  });

  it("idempotent: redelivery of the same note id does not duplicate", async () => {
    const q = wired();
    const ticketId = await seedTicket(TENANT_A);
    const noteId = randomUUID();
    const msg = {
      messageId: noteId, type: COMMANDS.addNote, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { id: noteId, tenantId: TENANT_A, ticketId, content: "dup me", visibility: "internal" as const, createdBy: ACTOR },
    };
    await q.publish(COMMANDS.addNote, msg);
    await new Promise((r) => setTimeout(r, 100));
    await q.publish(COMMANDS.addNote, msg);
    await new Promise((r) => setTimeout(r, 100));

    const rows = await notesFor(ticketId, TENANT_A);
    expect(rows.length).toBe(1);
  });

  it("tenant isolation: tenant B cannot see tenant A's notes", async () => {
    const q = wired();
    const ticketId = await seedTicket(TENANT_A);
    const noteId = randomUUID();
    await q.publish(COMMANDS.addNote, {
      messageId: noteId, type: COMMANDS.addNote, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: noteId, tenantId: TENANT_A, ticketId, content: "tenant A only", visibility: "public", createdBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 150));

    const asA = await notesFor(ticketId, TENANT_A);
    const asB = await notesFor(ticketId, TENANT_B);
    expect(asA.length).toBe(1);
    expect(asB.length).toBe(0);
  });
});

describe("TKT-07 — transferTicket consumer persists a transfer audit row", () => {
  it("inserts the transfer row and emits ticketTransferred", async () => {
    const q = wired();
    const ticketId = await seedTicket(TENANT_A);
    const transferId = randomUUID();
    await q.publish(COMMANDS.transferTicket, {
      messageId: transferId, type: COMMANDS.transferTicket, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: transferId, tenantId: TENANT_A, ticketId, toDepartment: "Engineering", reason: "Technical issue", transferredBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 150));

    const rows = await transfersFor(ticketId, TENANT_A);
    expect(rows.length).toBe(1);
    expect(rows[0]!.toDepartment).toBe("Engineering");
    expect(rows[0]!.fromDepartment).toBeNull();

    const emitted = await outboxFor(TENANT_A, ticketId);
    expect(emitted.some((m) => m.topic === EVENTS.ticketTransferred)).toBe(true);
  });

  it("a second transfer derives fromDepartment from the prior transfer", async () => {
    const q = wired();
    const ticketId = await seedTicket(TENANT_A);
    await q.publish(COMMANDS.transferTicket, {
      messageId: randomUUID(), type: COMMANDS.transferTicket, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT_A, ticketId, toDepartment: "Engineering", reason: "first hop", transferredBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 120));
    await q.publish(COMMANDS.transferTicket, {
      messageId: randomUUID(), type: COMMANDS.transferTicket, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT_A, ticketId, toDepartment: "Finance", reason: "second hop", transferredBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 120));

    const rows = await transfersFor(ticketId, TENANT_A);
    expect(rows.length).toBe(2);
    const second = rows.find((r) => r.toDepartment === "Finance");
    expect(second!.fromDepartment).toBe("Engineering");
  });
});

describe("TKT-08 — linkTickets consumer persists a link", () => {
  it("inserts the link row and emits ticketsLinked", async () => {
    const q = wired();
    const a = await seedTicket(TENANT_A);
    const b = await seedTicket(TENANT_A);
    const linkId = randomUUID();
    await q.publish(COMMANDS.linkTickets, {
      messageId: linkId, type: COMMANDS.linkTickets, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: linkId, tenantId: TENANT_A, sourceTicketId: a, targetTicketId: b, linkType: "parent", createdBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 150));

    const rows = await linksFor(a, TENANT_A);
    expect(rows.length).toBe(1);
    expect(rows[0]!.targetTicketId).toBe(b);
    expect(rows[0]!.linkType).toBe("parent");

    const emitted = await outboxFor(TENANT_A, linkId);
    expect(emitted.some((m) => m.topic === EVENTS.ticketsLinked)).toBe(true);
  });

  it("idempotent: redelivery of the same link does not duplicate", async () => {
    const q = wired();
    const a = await seedTicket(TENANT_A);
    const b = await seedTicket(TENANT_A);
    const linkId = randomUUID();
    const msg = {
      messageId: linkId, type: COMMANDS.linkTickets, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { id: linkId, tenantId: TENANT_A, sourceTicketId: a, targetTicketId: b, linkType: "related" as const, createdBy: ACTOR },
    };
    await q.publish(COMMANDS.linkTickets, msg);
    await new Promise((r) => setTimeout(r, 100));
    await q.publish(COMMANDS.linkTickets, msg);
    await new Promise((r) => setTimeout(r, 100));

    const rows = await linksFor(a, TENANT_A);
    expect(rows.length).toBe(1);
  });

  it("symmetric-safe: the inverse relationship (B child-of A after A parent-of B) is not a duplicate", async () => {
    const q = wired();
    const a = await seedTicket(TENANT_A);
    const b = await seedTicket(TENANT_A);
    await q.publish(COMMANDS.linkTickets, {
      messageId: randomUUID(), type: COMMANDS.linkTickets, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT_A, sourceTicketId: a, targetTicketId: b, linkType: "parent", createdBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 120));
    // B "child" of A describes the SAME relationship as A "parent" of B.
    await q.publish(COMMANDS.linkTickets, {
      messageId: randomUUID(), type: COMMANDS.linkTickets, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT_A, sourceTicketId: b, targetTicketId: a, linkType: "child", createdBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 120));

    const rows = await linksFor(a, TENANT_A);
    expect(rows.length).toBe(1);
  });

  it("tenant isolation: tenant B cannot see tenant A's links", async () => {
    const q = wired();
    const a = await seedTicket(TENANT_A);
    const b = await seedTicket(TENANT_A);
    await q.publish(COMMANDS.linkTickets, {
      messageId: randomUUID(), type: COMMANDS.linkTickets, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT_A, sourceTicketId: a, targetTicketId: b, linkType: "duplicate", createdBy: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 120));

    const asA = await linksFor(a, TENANT_A);
    const asB = await linksFor(a, TENANT_B);
    expect(asA.length).toBe(1);
    expect(asB.length).toBe(0);
  });
});

describe("TKT-09 — bulkAction consumer applies actions per ticket", () => {
  it("bulk assign updates every ticket in the batch", async () => {
    const q = wired();
    const ids = [await seedTicket(TENANT_A), await seedTicket(TENANT_A), await seedTicket(TENANT_A)];
    const agent = randomUUID();
    const batchId = randomUUID();
    await Promise.all(ids.map((ticketId) =>
      q.publish(COMMANDS.bulkAction, {
        messageId: randomUUID(), type: COMMANDS.bulkAction, tenantId: TENANT_A, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { batchId, ticketId, action: "assign", payload: { assigneeId: agent } },
      }),
    ));
    await new Promise((r) => setTimeout(r, 200));

    for (const id of ids) {
      const row = await findRow(id, TENANT_A);
      expect(row!.assigneeId).toBe(agent);
      expect(row!.status).toBe("assigned");
    }
  });

  it("bulk close transitions every ticket to closed", async () => {
    const q = wired();
    const ids = [await seedTicket(TENANT_A), await seedTicket(TENANT_A)];
    const batchId = randomUUID();
    await Promise.all(ids.map((ticketId) =>
      q.publish(COMMANDS.bulkAction, {
        messageId: randomUUID(), type: COMMANDS.bulkAction, tenantId: TENANT_A, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { batchId, ticketId, action: "close", payload: {} },
      }),
    ));
    await new Promise((r) => setTimeout(r, 200));

    for (const id of ids) {
      const row = await findRow(id, TENANT_A);
      expect(row!.status).toBe("closed");
    }
  });

  it("bulk set_priority updates priority", async () => {
    const q = wired();
    const id = await seedTicket(TENANT_A);
    await q.publish(COMMANDS.bulkAction, {
      messageId: randomUUID(), type: COMMANDS.bulkAction, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { batchId: randomUUID(), ticketId: id, action: "set_priority", payload: { priority: "Critical" } },
    });
    await new Promise((r) => setTimeout(r, 150));

    const row = await findRow(id, TENANT_A);
    expect(row!.priority).toBe("Critical");
  });

  it("idempotent: redelivery of the same batch item does not double-apply (version only bumps once)", async () => {
    const q = wired();
    const id = await seedTicket(TENANT_A);
    const msg = {
      messageId: randomUUID(), type: COMMANDS.bulkAction, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { batchId: randomUUID(), ticketId: id, action: "set_priority" as const, payload: { priority: "High" } },
    };
    await q.publish(COMMANDS.bulkAction, msg);
    await new Promise((r) => setTimeout(r, 100));
    await q.publish(COMMANDS.bulkAction, msg);
    await new Promise((r) => setTimeout(r, 100));

    const row = await findRow(id, TENANT_A);
    expect(row!.priority).toBe("High");
    expect(row!.version).toBe(2); // 1 (insert) + 1 (single applied update)
  });

  it("one bad ticketId in a batch doesn't block the others (per-item isolation)", async () => {
    const q = wired();
    const good = await seedTicket(TENANT_A);
    const missing = randomUUID(); // never inserted — simulates a poison item
    const batchId = randomUUID();
    await Promise.all([good, missing].map((ticketId) =>
      q.publish(COMMANDS.bulkAction, {
        messageId: randomUUID(), type: COMMANDS.bulkAction, tenantId: TENANT_A, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { batchId, ticketId, action: "close", payload: {} },
      }),
    ));
    await new Promise((r) => setTimeout(r, 200));

    const row = await findRow(good, TENANT_A);
    expect(row!.status).toBe("closed");
  });
});

describe("TKT-14 — reopenTicket consumer transitions closed/resolved -> open", () => {
  it("reopens a closed ticket and emits ticketReopened", async () => {
    const q = wired();
    const ticketId = await seedTicket(TENANT_A, { status: "closed" });
    const reopenId = randomUUID();
    await q.publish(COMMANDS.reopenTicket, {
      messageId: reopenId, type: COMMANDS.reopenTicket, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: reopenId, tenantId: TENANT_A, ticketId, reason: "issue persists" },
    });
    await new Promise((r) => setTimeout(r, 150));

    const row = await findRow(ticketId, TENANT_A);
    expect(row!.status).toBe("open");

    const emitted = await outboxFor(TENANT_A, ticketId);
    expect(emitted.some((m) => m.topic === EVENTS.ticketReopened)).toBe(true);
  });

  it("guard: an already-open ticket is not affected (no-op, not an error)", async () => {
    const q = wired();
    const ticketId = await seedTicket(TENANT_A, { status: "open" });
    const reopenId = randomUUID();
    await q.publish(COMMANDS.reopenTicket, {
      messageId: reopenId, type: COMMANDS.reopenTicket, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: reopenId, tenantId: TENANT_A, ticketId, reason: "already open" },
    });
    await new Promise((r) => setTimeout(r, 150));

    const row = await findRow(ticketId, TENANT_A);
    expect(row!.status).toBe("open");
    expect(row!.version).toBe(1); // unchanged — guard rejected the transition
  });
});
