/**
 * correspondence module test suite (DB-backed, MemoryQueue)
 *
 * Test 1 — Running, non-overlapping page ranges + incrementing corr_no.
 * Test 2 — Page-number stability: a later add never renumbers earlier entries.
 * Test 3 — PUC multiplicity: two PUCs active at once; unmark sets active=false.
 * Test 4 — Audit events emitted (add_correspondence / mark_puc).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabCorrespondence, estabFilePuc } from "../src/modules/correspondence/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerCorrespondenceConsumers } from "../src/modules/correspondence/consumer.js";

// Unique random tenant per run so parallel/repeat runs never collide. All
// segments are valid hex (no letters g-z).
const TENANT = randomUUID();
const ACTOR  = randomUUID();
const FILE_1 = randomUUID();

const messageIds: string[] = [];

function envelope(topic: string, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  messageIds.push(messageId);
  return {
    messageId,
    type: topic,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function wipe() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(estabFilePuc).where(eq(estabFilePuc.tenantId, TENANT));
  await db.delete(estabCorrespondence).where(eq(estabCorrespondence.tenantId, TENANT));
  for (const id of messageIds) {
    await db.delete(processed).where(eq(processed.messageId, id));
  }
}

const settle = () => new Promise<void>((r) => setTimeout(r, 400));

describe("Correspondence — CSMOP page numbering & PUC", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("assigns running, non-overlapping page ranges and incrementing corr_no", async () => {
    const q = new MemoryQueue();
    registerCorrespondenceConsumers(q);
    await q.start();

    const c1 = randomUUID();
    const c2 = randomUUID();

    // C-1: 3 pages → 1..3
    await q.publish("estab.correspondence.add", envelope("estab.correspondence.add", {
      id: c1, fileId: FILE_1, tenantId: TENANT,
      direction: "incoming", party: "Ministry of Finance",
      subject: "Budget allocation query", numPages: 3,
    }));
    await settle();

    // C-2: 1 page → 4..4
    await q.publish("estab.correspondence.add", envelope("estab.correspondence.add", {
      id: c2, fileId: FILE_1, tenantId: TENANT,
      direction: "outgoing", party: "District Collector",
      subject: "Reply on allocation", numPages: 1,
    }));
    await settle();
    await q.stop();

    const rows = await db.select().from(estabCorrespondence)
      .where(and(eq(estabCorrespondence.tenantId, TENANT), eq(estabCorrespondence.fileId, FILE_1)))
      .orderBy(estabCorrespondence.pageFrom);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.corrNo).toBe("C-1");
    expect(rows[0]?.pageFrom).toBe(1);
    expect(rows[0]?.pageTo).toBe(3);
    expect(rows[1]?.corrNo).toBe("C-2");
    expect(rows[1]?.pageFrom).toBe(4);
    expect(rows[1]?.pageTo).toBe(4);

    // No overlap: each new range starts strictly after the previous page_to.
    expect(rows[1]!.pageFrom).toBeGreaterThan(rows[0]!.pageTo);
  });

  it("page numbers are STABLE — a third add does not renumber earlier rows", async () => {
    const q = new MemoryQueue();
    registerCorrespondenceConsumers(q);
    await q.start();

    // Snapshot the first two entries before adding a third.
    const before = await db.select().from(estabCorrespondence)
      .where(and(eq(estabCorrespondence.tenantId, TENANT), eq(estabCorrespondence.fileId, FILE_1)))
      .orderBy(estabCorrespondence.pageFrom);
    expect(before).toHaveLength(2);

    const c3 = randomUUID();
    await q.publish("estab.correspondence.add", envelope("estab.correspondence.add", {
      id: c3, fileId: FILE_1, tenantId: TENANT,
      direction: "incoming", party: "Audit Cell",
      subject: "Observation memo", numPages: 2,
    }));
    await settle();
    await q.stop();

    const after = await db.select().from(estabCorrespondence)
      .where(and(eq(estabCorrespondence.tenantId, TENANT), eq(estabCorrespondence.fileId, FILE_1)))
      .orderBy(estabCorrespondence.pageFrom);

    expect(after).toHaveLength(3);
    // Earlier rows untouched.
    expect(after[0]?.pageFrom).toBe(before[0]?.pageFrom);
    expect(after[0]?.pageTo).toBe(before[0]?.pageTo);
    expect(after[1]?.pageFrom).toBe(before[1]?.pageFrom);
    expect(after[1]?.pageTo).toBe(before[1]?.pageTo);
    // New row appends after the running max (4) → 5..6.
    expect(after[2]?.corrNo).toBe("C-3");
    expect(after[2]?.pageFrom).toBe(5);
    expect(after[2]?.pageTo).toBe(6);
  });

  it("supports multiple simultaneous active PUCs; unmark sets active=false", async () => {
    const q = new MemoryQueue();
    registerCorrespondenceConsumers(q);
    await q.start();

    const rows = await db.select().from(estabCorrespondence)
      .where(and(eq(estabCorrespondence.tenantId, TENANT), eq(estabCorrespondence.fileId, FILE_1)))
      .orderBy(estabCorrespondence.pageFrom);
    const corrA = rows[0]!.id;
    const corrB = rows[1]!.id;

    // Mark two PUCs.
    await q.publish("estab.file.puc.mark", envelope("estab.file.puc.mark", {
      id: randomUUID(), fileId: FILE_1, tenantId: TENANT, correspondenceId: corrA,
    }));
    await q.publish("estab.file.puc.mark", envelope("estab.file.puc.mark", {
      id: randomUUID(), fileId: FILE_1, tenantId: TENANT, correspondenceId: corrB,
    }));
    await settle();

    let active = await db.select().from(estabFilePuc).where(and(
      eq(estabFilePuc.tenantId, TENANT),
      eq(estabFilePuc.fileId, FILE_1),
      eq(estabFilePuc.active, true),
    ));
    expect(active).toHaveLength(2);

    // Unmark the first.
    await q.publish("estab.file.puc.unmark", envelope("estab.file.puc.unmark", {
      id: randomUUID(), fileId: FILE_1, tenantId: TENANT, correspondenceId: corrA,
    }));
    await settle();
    await q.stop();

    active = await db.select().from(estabFilePuc).where(and(
      eq(estabFilePuc.tenantId, TENANT),
      eq(estabFilePuc.fileId, FILE_1),
      eq(estabFilePuc.active, true),
    ));
    expect(active).toHaveLength(1);
    expect(active[0]?.correspondenceId).toBe(corrB);

    const deactivated = await db.select().from(estabFilePuc).where(and(
      eq(estabFilePuc.tenantId, TENANT),
      eq(estabFilePuc.correspondenceId, corrA),
    ));
    expect(deactivated[0]?.active).toBe(false);
  });

  it("emits audit events for add_correspondence and mark_puc", async () => {
    const outbox = await db.select().from(outboxMessages).where(and(
      eq(outboxMessages.tenantId, TENANT),
      eq(outboxMessages.eventType, "audit.event.record"),
    ));
    const actions = outbox.map((r) => (r.payload as { action?: string }).action);
    expect(actions).toContain("add_correspondence");
    expect(actions).toContain("mark_puc");
    expect(actions).toContain("unmark_puc");
  });
});
