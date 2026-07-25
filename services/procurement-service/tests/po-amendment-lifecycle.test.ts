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
const OTHER  = "7c7c7c7c-2222-4000-8000-0000000000c2";
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


describe("SVC-046 PO amendment — multi-amendment lost-update guard (regression)", () => {
  // Two amendments are REQUESTED against the same PO before either is approved,
  // so both capture the same request-time snapshot (prevTotal=1_000_000).
  // Approving A moves the PO to 1_100_000; approving B must NOT blindly write
  // B's stale snapshot (1_050_000) — that would erase A's +100_000 delta.
  // Semantics implemented: REJECT-STALE (see amendment-consumer approve handler).
  const poId = randomUUID();
  const amdA = randomUUID();
  const amdB = randomUUID();

  it("approving a stale second amendment is rejected, PO total keeps the first delta (never silently wrong)", async () => {
    await seedPo(poId, "approved", 1_000_000n);

    // Request A (+100_000) and B (+50_000) while both are still pending.
    const qa = wire(new MemoryQueue()); registerPoAmendmentConsumers(qa); await qa.start();
    await qa.publish(COMMANDS.poAmendmentRequest, msg(COMMANDS.poAmendmentRequest, {
      id: amdA, poId, tenantId: TENANT, amendmentType: "change_order",
      reason: "Amendment A: +100000", deltaMinor: 100_000,
    }, MAKER));
    await drain(qa);
    const qb = wire(new MemoryQueue()); registerPoAmendmentConsumers(qb); await qb.start();
    await qb.publish(COMMANDS.poAmendmentRequest, msg(COMMANDS.poAmendmentRequest, {
      id: amdB, poId, tenantId: TENANT, amendmentType: "change_order",
      reason: "Amendment B: +50000", deltaMinor: 50_000,
    }, MAKER));
    await drain(qb);

    // Both snapshots were taken against the same base total of 1_000_000.
    const bBefore = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, amdB)))))[0];
    expect(bBefore?.prevTotalMinor).toBe(1_000_000n);
    expect(bBefore?.newTotalMinor).toBe(1_050_000n); // stale snapshot

    // Approve A (distinct checker) -> PO total becomes 1_100_000.
    const q1 = wire(new MemoryQueue()); registerPoAmendmentConsumers(q1); await q1.start();
    await q1.publish(COMMANDS.poAmendmentApprove, msg(COMMANDS.poAmendmentApprove, { poId, amendmentId: amdA, tenantId: TENANT }, CHECKER));
    await drain(q1);
    const aRow = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, amdA)))))[0];
    expect(aRow?.status).toBe("approved");
    let po = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId)))))[0];
    expect(po?.totalMinor).toBe(1_100_000n);

    // Approve B: its base (1_000_000) no longer matches the live PO total
    // (1_100_000) -> the staleness guard rejects it as AMENDMENT_STALE_BASE.
    const q2 = wire(new MemoryQueue()); registerPoAmendmentConsumers(q2); await q2.start();
    await q2.publish(COMMANDS.poAmendmentApprove, msg(COMMANDS.poAmendmentApprove, { poId, amendmentId: amdB, tenantId: TENANT }, CHECKER));
    await drain(q2);

    const bRow = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, amdB)))))[0];
    expect(bRow?.status).toBe("rejected");
    expect(bRow?.rejectedReason).toContain("AMENDMENT_STALE_BASE");

    // The PO total is NEVER the stale 1_050_000 — A's delta is preserved.
    po = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId)))))[0];
    expect(po?.totalMinor).toBe(1_100_000n);
    expect(po?.totalMinor).not.toBe(1_050_000n);
  });
});

describe("SVC-046 PO amendment — cross-tenant RLS isolation", () => {
  const poId = randomUUID();
  const amendmentId = randomUUID();

  it("a foreign tenant cannot see or amend another tenant's PO (tenant isolation)", async () => {
    await seedPo(poId, "approved", 1_000_000n); // belongs to TENANT

    // A foreign-tenant (OTHER) amend command against tenant-A's PO is a no-op:
    // the consumer's tenant-scoped read finds no PO, so no amendment is written.
    const q = wire(new MemoryQueue()); registerPoAmendmentConsumers(q); await q.start();
    await q.publish(COMMANDS.poAmendmentRequest, msg(COMMANDS.poAmendmentRequest, {
      id: amendmentId, poId, tenantId: OTHER, amendmentType: "change_order",
      reason: "cross-tenant attempt", deltaMinor: 100_000,
    }, MAKER, OTHER));
    await drain(q);

    // No amendment row exists for that id under EITHER tenant's scope.
    const inOther = await runWithTenant(OTHER, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(and(eq(procurementPoAmendments.id, amendmentId), eq(procurementPoAmendments.tenantId, OTHER)))));
    expect(inOther).toHaveLength(0);
    const inTenant = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, amendmentId))));
    expect(inTenant).toHaveLength(0);

    // Tenant-A's PO total is untouched by the cross-tenant attempt.
    const po = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId)))))[0];
    expect(po?.totalMinor).toBe(1_000_000n);
  });
});
