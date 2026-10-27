/**
 * D4c #19 (GAP-PROCUREMENT-ORDERS-DETAIL-01, owner decision 2026-10-27): the
 * workflow inbox (procurement.po.approve, maker-checker) is the ONLY approval
 * path for a purchase order; an eOffice file-noting decision
 * (procurement.po.file_decided) is optional, is only RECORDED, and never gates
 * release. This file formerly pinned SoD enforcement on the eOffice path that
 * could approve a PO; that path no longer exists, so it now pins the opposite:
 * no eOffice decision, by anyone, changes a PO's status or emits an approval.
 * The maker-checker control lives on the workflow path (see the second describe).
 *
 * Historical context (SoD on the formerly-live eOffice approval path):
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
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { COMMANDS, CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

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

describe("eOffice PO decision callback — recorded only, never decides (D4c #19)", () => {
  for (const [decision, by] of [["approved", CHECKER], ["approved", MAKER], ["rejected", MAKER], ["returned", CHECKER]] as const) {
    it(`a ${decision} eOffice decision by ${by === MAKER ? "the creator" : "another officer"} leaves the PO status untouched and emits no approval/cancel`, async () => {
      const poId = randomUUID();
      await seedPo(poId, MAKER);
      const q = wire(new MemoryQueue()); registerEOfficeDecisionConsumers(q); await q.start();
      await q.publish(CONSUMED_EVENTS.poFileDecided, fileDecided(poId, decision, by));
      await drain(q);

      const po = await getPo(poId);
      expect(po?.status).toBe("pending");
      expect(po?.updatedBy).toBe(MAKER);
      expect((await eventsFor(EVENTS.poApproved, poId)).length).toBe(0);
      expect((await eventsFor(EVENTS.poApprovalRejected, poId)).length).toBe(0);

      // ...but the noting decision IS recorded (audit trail), with the file number.
      const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
        tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))));
      const mine = audits.filter((a) => (a.payload as Record<string, unknown>)?.resourceId === poId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.payload).toMatchObject({ action: "eoffice_decision_recorded", resourceType: "po" });
      expect(JSON.stringify(mine[0]!.payload)).toContain("PROC/2026/1");
    });
  }

  it("is idempotent per message and ignores an unknown PO", async () => {
    const poId = randomUUID();
    await seedPo(poId, MAKER);
    const q = wire(new MemoryQueue()); registerEOfficeDecisionConsumers(q); await q.start();
    const msg = fileDecided(poId, "approved", CHECKER);
    await q.publish(CONSUMED_EVENTS.poFileDecided, msg);
    await q.publish(CONSUMED_EVENTS.poFileDecided, msg); // replay, same messageId
    await q.publish(CONSUMED_EVENTS.poFileDecided, fileDecided(randomUUID(), "approved", CHECKER)); // unknown PO
    await drain(q);
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))));
    expect(audits.filter((a) => (a.payload as Record<string, unknown>)?.resourceId === poId)).toHaveLength(1);
  });
});

describe("workflow inbox approval (procurement.po.approve) is the single, maker-checker release path", () => {
  async function approveVia(poId: string, actor: string) {
    const q = wire(new MemoryQueue()); registerPoConsumers(q); await q.start();
    await q.publish(COMMANDS.poApprove, {
      messageId: randomUUID(), type: COMMANDS.poApprove, tenantId: TENANT, actorId: actor,
      correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload: { id: poId, tenantId: TENANT },
    });
    await drain(q);
  }

  it("a distinct approver releases the PO", async () => {
    const poId = randomUUID();
    await seedPo(poId, MAKER);
    await approveVia(poId, CHECKER);
    expect((await getPo(poId))?.status).toBe("approved");
    expect((await eventsFor(EVENTS.poApproved, poId)).length).toBeGreaterThanOrEqual(1);
  });

  it("the creator cannot approve their own PO; it stays pending with an SOD_VIOLATION rejection", async () => {
    const poId = randomUUID();
    await seedPo(poId, MAKER);
    await approveVia(poId, MAKER);
    expect((await getPo(poId))?.status).toBe("pending");
    const rejections = await eventsFor(EVENTS.poApprovalRejected, poId);
    expect((rejections[0]!.payload as Record<string, unknown>).code).toBe("SOD_VIOLATION");
  });
});
