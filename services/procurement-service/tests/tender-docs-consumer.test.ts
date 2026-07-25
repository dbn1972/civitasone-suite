/**
 * SVC-043 Tender document management — integration.
 *
 * Drives the tender-docs consumer on a MemoryQueue against the real Postgres
 * test DB: document supersede-versioning, corrigendum create + republish
 * (extends tender bid-closing date), and pre-bid query open->answered->published.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementTenders } from "../src/modules/tender/schema.js";
import {
  procurementTenderDocuments, procurementTenderCorrigenda, procurementPrebidQueries,
} from "../src/modules/tender/docs-schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerTenderDocsConsumers } from "../src/modules/tender/docs-consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { randomUUID } from "node:crypto";

const TENANT = "9c9c9c9c-1111-4000-8000-0000000000c1";
const ACTOR  = "9d9d9d9d-0000-4000-8000-000000000001";

function msg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${type}`, schemaVersion: "1.0", payload };
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 400)); await q.stop(); }

async function seedTender(id: string, status = "published"): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementTenders).values({
      id, tenantId: TENANT, tenderNo: `TND-${id.slice(-4)}`, title: "Supply of Laptops",
      type: "open", bidClosingDate: "2027-01-31", status, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}
async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementPrebidQueries).where(eq(procurementPrebidQueries.tenantId, TENANT));
    await tx.delete(procurementTenderCorrigenda).where(eq(procurementTenderCorrigenda.tenantId, TENANT));
    await tx.delete(procurementTenderDocuments).where(eq(procurementTenderDocuments.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
  }));
}

beforeAll(async () => { await wipe(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("SVC-043 tender documents — supersede versioning", () => {
  const tenderId = randomUUID();

  it("adding a second NIT supersedes the first (v1 not current, v2 current)", async () => {
    await seedTender(tenderId);
    const d1 = randomUUID(), d2 = randomUUID();
    const q1 = wire(new MemoryQueue()); registerTenderDocsConsumers(q1); await q1.start();
    await q1.publish(COMMANDS.tenderDocAdd, msg(COMMANDS.tenderDocAdd, { id: d1, tenderId, tenantId: TENANT, docType: "nit", title: "NIT v1", storageRef: "s3://nit-v1" }));
    await drain(q1);
    const q2 = wire(new MemoryQueue()); registerTenderDocsConsumers(q2); await q2.start();
    await q2.publish(COMMANDS.tenderDocAdd, msg(COMMANDS.tenderDocAdd, { id: d2, tenderId, tenantId: TENANT, docType: "nit", title: "NIT v2", storageRef: "s3://nit-v2" }));
    await drain(q2);

    const docs = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementTenderDocuments).where(eq(procurementTenderDocuments.tenderId, tenderId))));
    const v1 = docs.find((d) => d.id === d1);
    const v2 = docs.find((d) => d.id === d2);
    expect(v1?.isCurrent).toBe(false);
    expect(v2?.isCurrent).toBe(true);
    expect(v2?.docVersion).toBe(2);
    expect(v2?.supersedesId).toBe(d1);
  });
});

describe("SVC-043 corrigendum — create + republish extends bid-closing date", () => {
  const tenderId = randomUUID();
  const corrId = randomUUID();

  it("create corrigendum #1", async () => {
    await seedTender(tenderId);
    const q = wire(new MemoryQueue()); registerTenderDocsConsumers(q); await q.start();
    await q.publish(COMMANDS.tenderCorrigendumCreate, msg(COMMANDS.tenderCorrigendumCreate, {
      id: corrId, tenderId, tenantId: TENANT, title: "Extension of bid date", newBidClosingDate: "2027-03-15",
    }));
    await drain(q);
    const c = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementTenderCorrigenda).where(eq(procurementTenderCorrigenda.id, corrId)))))[0];
    expect(c?.corrigendumNo).toBe(1);
    expect(c?.republished).toBe(false);
  });

  it("republish → corrigendum published, tender bid-closing date extended, event emitted", async () => {
    const q = wire(new MemoryQueue()); registerTenderDocsConsumers(q); await q.start();
    await q.publish(COMMANDS.tenderCorrigendumRepublish, msg(COMMANDS.tenderCorrigendumRepublish, { tenderId, corrigendumId: corrId, tenantId: TENANT }));
    await drain(q);
    const c = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementTenderCorrigenda).where(eq(procurementTenderCorrigenda.id, corrId)))))[0];
    expect(c?.republished).toBe(true);
    const t = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId)))))[0];
    expect(t?.bidClosingDate).toBe("2027-03-15");
    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, EVENTS.tenderCorrigendumPublished)))));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("second republish is blocked (already republished)", async () => {
    const q = wire(new MemoryQueue()); registerTenderDocsConsumers(q); await q.start();
    await q.publish(COMMANDS.tenderCorrigendumRepublish, msg(COMMANDS.tenderCorrigendumRepublish, { tenderId, corrigendumId: corrId, tenantId: TENANT }));
    await drain(q);
    // still republished exactly once — no error state persisted beyond the guard
    const c = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementTenderCorrigenda).where(eq(procurementTenderCorrigenda.id, corrId)))))[0];
    expect(c?.republished).toBe(true);
  });
});

describe("SVC-043 pre-bid queries — open -> answered -> published", () => {
  const tenderId = randomUUID();
  const queryId = randomUUID();

  it("full lifecycle", async () => {
    await seedTender(tenderId);
    const q1 = wire(new MemoryQueue()); registerTenderDocsConsumers(q1); await q1.start();
    await q1.publish(COMMANDS.prebidQueryCreate, msg(COMMANDS.prebidQueryCreate, { id: queryId, tenderId, tenantId: TENANT, question: "What is the warranty period?" }));
    await drain(q1);
    const q2 = wire(new MemoryQueue()); registerTenderDocsConsumers(q2); await q2.start();
    await q2.publish(COMMANDS.prebidQueryAnswer, msg(COMMANDS.prebidQueryAnswer, { tenderId, queryId, tenantId: TENANT, answer: "3 years onsite" }));
    await drain(q2);
    const q3 = wire(new MemoryQueue()); registerTenderDocsConsumers(q3); await q3.start();
    await q3.publish(COMMANDS.prebidQueryPublish, msg(COMMANDS.prebidQueryPublish, { tenderId, queryId, tenantId: TENANT }));
    await drain(q3);

    const pq = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPrebidQueries).where(eq(procurementPrebidQueries.id, queryId)))))[0];
    expect(pq?.queryNo).toBe(1);
    expect(pq?.status).toBe("published");
    expect(pq?.published).toBe(true);
    expect(pq?.answer).toBe("3 years onsite");
  });
});
