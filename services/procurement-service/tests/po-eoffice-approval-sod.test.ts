/**
 * SoD (segregation of duties) enforcement on the eOffice PO-approval callback
 * path (procurement.po.file_decided).
 *
 * po/consumer.ts's poApprove command handler already enforces
 * assertDistinctMakerChecker — the approver must differ from the PO's
 * creator (see po-amendment-lifecycle.test.ts for the equivalent coverage on
 * PO amendments). But a PO can ALSO reach "approved" through a second,
 * independent, live path: raising it as an eFile in eOffice (estab-service's
 * file-noting workflow) and applying whatever decision comes back on
 * procurement.po.file_decided (see eoffice-consumer.ts). That path applied
 * cb.decidedBy with no distinctness check at all. estab-service's own
 * file-noting chain (services/estab-service/src/modules/files/consumer.ts)
 * enforces no such check either — nothing anywhere stopped a PO's own
 * creator from eOffice-approving their own PO.
 *
 * Drives the real consumer on a MemoryQueue against the real Postgres test
 * DB, exactly as po-amendment-lifecycle.test.ts does for the sibling
 * maker-checker path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerEOfficeDecisionConsumers } from "../src/modules/po/eoffice-consumer.js";
import { CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

const TENANT  = "8e8e8e8e-1111-4000-8000-0000000000e1";
const MAKER   = "8f8f8f8f-0000-4000-8000-000000000001";
const CHECKER = "8f8f8f8f-0000-4000-8000-000000000002";

function fileDecided(refId: string, decision: "approved" | "rejected" | "returned", decidedBy: string) {
  return {
    messageId: randomUUID(),
    type: CONSUMED_EVENTS.poFileDecided,
    tenantId: TENANT,
    actorId: decidedBy,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload: {
      fileId: randomUUID(),
      fileNo: "PROC/2026/1",
      refType: "procurement_po",
      refId,
      decision,
      decidedBy,
      decidedAt: new Date().toISOString(),
    },
  };
}

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 400)); await q.stop(); }

async function seedPo(id: string, createdBy: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementPos).values({
      id, tenantId: TENANT, poNo: `PO-${id.slice(-4)}`, vendorId: randomUUID(),
      indentRef: "procurement_indent:seed", orderType: "supply", totalMinor: 500_000n,
      currency: "INR", status: "pending", createdBy, updatedBy: createdBy,
    });
  }));
}

async function getPo(id: string) {
  return (await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementPos).where(eq(procurementPos.id, id)))))[0];
}

async function eventsFor(topic: string, poId: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, topic)))));
  return rows.filter((r) => (r.payload as Record<string, unknown>)?.poId === poId);
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

beforeAll(async () => { await wipe(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("eOffice PO-approval callback — SoD enforcement", () => {
  it("creator self-approving their own PO via the eOffice callback is rejected, PO stays pending", async () => {
    const poId = randomUUID();
    await seedPo(poId, MAKER);
    const q = wire(new MemoryQueue()); registerEOfficeDecisionConsumers(q); await q.start();
    await q.publish(CONSUMED_EVENTS.poFileDecided, fileDecided(poId, "approved", MAKER));
    await drain(q);

    const po = await getPo(poId);
    expect(po?.status).toBe("pending");

    const rejections = await eventsFor(EVENTS.poApprovalRejected, poId);
    expect(rejections.length).toBeGreaterThanOrEqual(1);
    expect((rejections[0]!.payload as Record<string, unknown>).code).toBe("SOD_VIOLATION");

    const approvals = await eventsFor(EVENTS.poApproved, poId);
    expect(approvals.length).toBe(0);
  });

  it("a distinct checker's eOffice approval still succeeds normally", async () => {
    const poId = randomUUID();
    await seedPo(poId, MAKER);
    const q = wire(new MemoryQueue()); registerEOfficeDecisionConsumers(q); await q.start();
    await q.publish(CONSUMED_EVENTS.poFileDecided, fileDecided(poId, "approved", CHECKER));
    await drain(q);

    const po = await getPo(poId);
    expect(po?.status).toBe("approved");
    expect(po?.updatedBy).toBe(CHECKER);

    const approvals = await eventsFor(EVENTS.poApproved, poId);
    expect(approvals.length).toBeGreaterThanOrEqual(1);
  });

  it("self-decided REJECTION via eOffice is unaffected by the SoD guard (only approval is gated)", async () => {
    const poId = randomUUID();
    await seedPo(poId, MAKER);
    const q = wire(new MemoryQueue()); registerEOfficeDecisionConsumers(q); await q.start();
    await q.publish(CONSUMED_EVENTS.poFileDecided, fileDecided(poId, "rejected", MAKER));
    await drain(q);

    const po = await getPo(poId);
    expect(po?.status).toBe("cancelled");

    const rejections = await eventsFor(EVENTS.poApprovalRejected, poId);
    expect(rejections.length).toBe(0);
  });
});
