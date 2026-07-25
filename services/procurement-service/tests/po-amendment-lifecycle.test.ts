/**
 * SVC-046 PO / Work-order amendment + milestone + closure — integration.
 *
 * Drives the amendment maker-checker and closure guard through the real consumer
 * on a MemoryQueue against the real Postgres test DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import {
  procurementPos, procurementPoAmendments, procurementPoMilestones,
} from "../src/modules/po/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerPoAmendmentConsumers } from "../src/modules/po/amendment-consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { randomUUID } from "node:crypto";

const TENANT = "7c7c7c7c-1111-4000-8000-0000000000c1";
const MAKER   = "7d7d7d7d-0000-4000-8000-000000000001";
const CHECKER = "7d7d7d7d-0000-4000-8000-000000000002";

function msg(type: string, payload: Record<string, unknown>, actorId = MAKER, tenantId = TENANT) {
  return { messageId: randomUUID(), type, tenantId, actorId, correlationId: `corr-${type}`, schemaVersion: "1.0", payload };
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 400)); await q.stop(); }

async function seedPo(id: string, status = "approved", totalMinor = 1_000_000n): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementPos).values({
      id, tenantId: TENANT, poNo: `PO-${id.slice(-4)}`, vendorId: randomUUID(),
      indentRef: "procurement_indent:seed", orderType: "work", totalMinor, currency: "INR",
      status, createdBy: MAKER, updatedBy: MAKER,
    });
  }));
}
async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementPoMilestones).where(eq(procurementPoMilestones.tenantId, TENANT));
    await tx.delete(procurementPoAmendments).where(eq(procurementPoAmendments.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

beforeAll(async () => { await wipe(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("SVC-046 PO amendment — maker-checker + change order", () => {
  const poId = randomUUID();
  const amendmentId = randomUUID();

  it("request amendment → pending amendment #1 with computed delta", async () => {
    await seedPo(poId, "approved", 1_000_000n);
    const q = wire(new MemoryQueue()); registerPoAmendmentConsumers(q); await q.start();
    await q.publish(COMMANDS.poAmendmentRequest, msg(COMMANDS.poAmendmentRequest, {
      id: amendmentId, poId, tenantId: TENANT, amendmentType: "change_order",
      reason: "Additional scope for civil works", deltaMinor: 250000,
    }, MAKER));
    await drain(q);
    const a = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, amendmentId)))))[0];
    expect(a?.status).toBe("pending");
    expect(a?.amendmentNo).toBe(1);
    expect(a?.newTotalMinor).toBe(1_250_000n);
  });

  it("maker cannot self-approve — amendment stays pending, PO total unchanged", async () => {
    const q = wire(new MemoryQueue()); registerPoAmendmentConsumers(q); await q.start();
    await q.publish(COMMANDS.poAmendmentApprove, msg(COMMANDS.poAmendmentApprove, { poId, amendmentId, tenantId: TENANT }, MAKER));
    await drain(q);
    const a = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, amendmentId)))))[0];
    expect(a?.status).toBe("pending");
    const po = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId)))))[0];
    expect(po?.totalMinor).toBe(1_000_000n);
  });

  it("distinct checker approves → amendment approved, PO total updated, po.amended emitted", async () => {
    const q = wire(new MemoryQueue()); registerPoAmendmentConsumers(q); await q.start();
    await q.publish(COMMANDS.poAmendmentApprove, msg(COMMANDS.poAmendmentApprove, { poId, amendmentId, tenantId: TENANT }, CHECKER));
    await drain(q);
    const a = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, amendmentId)))))[0];
    expect(a?.status).toBe("approved");
    const po = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId)))))[0];
    expect(po?.totalMinor).toBe(1_250_000n);
    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, EVENTS.poAmended)))));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SVC-046 PO milestones + closure", () => {
  const poId = randomUUID();
  const msId = randomUUID();

  it("add milestone → milestone #1 pending", async () => {
    await seedPo(poId, "dispatched", 500000n);
    const q = wire(new MemoryQueue()); registerPoAmendmentConsumers(q); await q.start();
    await q.publish(COMMANDS.poMilestoneAdd, msg(COMMANDS.poMilestoneAdd, {
      id: msId, poId, tenantId: TENANT, title: "Phase 1 delivery", amountMinor: 500000,
    }));
    await drain(q);
    const m = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoMilestones).where(eq(procurementPoMilestones.id, msId)))))[0];
    expect(m?.milestoneNo).toBe(1);
    expect(m?.status).toBe("pending");
  });

  it("closure blocked while milestone is open", async () => {
    const q = wire(new MemoryQueue()); registerPoAmendmentConsumers(q); await q.start();
    await q.publish(COMMANDS.poClose, msg(COMMANDS.poClose, { poId, tenantId: TENANT }));
    await drain(q);
    const po = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId)))))[0];
    expect(po?.status).toBe("dispatched"); // not closed
  });

  it("deliver milestone then close succeeds → po.closed emitted", async () => {
    const q1 = wire(new MemoryQueue()); registerPoAmendmentConsumers(q1); await q1.start();
    await q1.publish(COMMANDS.poMilestoneUpdate, msg(COMMANDS.poMilestoneUpdate, { poId, milestoneId: msId, tenantId: TENANT, status: "delivered", deliveredQty: 1 }));
    await drain(q1);
    const q = wire(new MemoryQueue()); registerPoAmendmentConsumers(q); await q.start();
    await q.publish(COMMANDS.poClose, msg(COMMANDS.poClose, { poId, tenantId: TENANT }));
    await drain(q);
    const po = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId)))))[0];
    expect(po?.status).toBe("closed");
    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, EVENTS.poClosed)))));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
