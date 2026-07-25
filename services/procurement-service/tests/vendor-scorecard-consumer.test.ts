/**
 * SVC-049 Vendor performance — integration.
 *
 * Drives the scorecard consumer on a MemoryQueue against the real Postgres test
 * DB: GRN accepted/rejected + contract-terminated events feed the performance
 * ledger and recompute an objective scorecard; show-cause enforces maker-checker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import {
  procurementVendorPerformanceEvents, procurementVendorScorecards, procurementVendorShowCause,
} from "../src/modules/vendor/scorecard-schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerVendorScorecardConsumers } from "../src/modules/vendor/scorecard-consumer.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../src/topics.js";
import { randomUUID } from "node:crypto";

const TENANT = "8e8e8e8e-1111-4000-8000-0000000000e1";
const ISSUER  = "8f8f8f8f-0000-4000-8000-000000000001";
const DECIDER = "8f8f8f8f-0000-4000-8000-000000000002";
const VENDOR  = "8a8a8a8a-0000-4000-8000-0000000000aa";

function msg(type: string, payload: Record<string, unknown>, actorId = ISSUER, tenantId = TENANT) {
  return { messageId: randomUUID(), type, tenantId, actorId, correlationId: `corr-${type}`, schemaVersion: "1.0", payload };
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 400)); await q.stop(); }

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementVendorPerformanceEvents).where(eq(procurementVendorPerformanceEvents.tenantId, TENANT));
    await tx.delete(procurementVendorScorecards).where(eq(procurementVendorScorecards.tenantId, TENANT));
    await tx.delete(procurementVendorShowCause).where(eq(procurementVendorShowCause.tenantId, TENANT));
  }));
}

beforeAll(async () => { await wipe(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("SVC-049 scorecard consumer — objective rating from events", () => {
  it("GRN accepted x8 + rejected x2 + contract-terminated x1 → computed scorecard", async () => {
    const q = wire(new MemoryQueue()); registerVendorScorecardConsumers(q); await q.start();
    for (let i = 0; i < 8; i++) {
      await q.publish(EVENTS.grnAccepted, msg(EVENTS.grnAccepted, { vendorId: VENDOR, grnId: randomUUID(), poRef: "po:x" }));
    }
    for (let i = 0; i < 2; i++) {
      await q.publish(EVENTS.grnRejected, msg(EVENTS.grnRejected, { vendorId: VENDOR, grnId: randomUUID(), poRef: "po:x" }));
    }
    await q.publish(CONSUMED_EVENTS.contractTerminated, msg(CONSUMED_EVENTS.contractTerminated, { vendorId: VENDOR, contractId: randomUUID() }));
    await drain(q);

    const sc = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementVendorScorecards).where(eq(procurementVendorScorecards.vendorId, VENDOR))));
    expect(sc).toHaveLength(1);
    expect(sc[0]?.totalOrders).toBe(10);
    expect(sc[0]?.qualityRejections).toBe(2);
    expect(sc[0]?.slaBreaches).toBe(1);
    // delivery=80, quality=80, sla=80 → overall 80 → band B
    expect(sc[0]?.overallRating).toBe(80);
    expect(sc[0]?.ratingBand).toBe("B");

    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, EVENTS.vendorScorecardComputed)))));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("event without a vendor attribution is an honest no-op", async () => {
    const before = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementVendorPerformanceEvents).where(eq(procurementVendorPerformanceEvents.tenantId, TENANT))));
    const q = wire(new MemoryQueue()); registerVendorScorecardConsumers(q); await q.start();
    await q.publish(EVENTS.grnRejected, msg(EVENTS.grnRejected, { grnId: randomUUID() })); // no vendorId
    await drain(q);
    const after = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementVendorPerformanceEvents).where(eq(procurementVendorPerformanceEvents.tenantId, TENANT))));
    expect(after.length).toBe(before.length);
  });
});

describe("SVC-049 show-cause — maker-checker", () => {
  const scId = randomUUID();

  it("issue → responded → decide(upheld) by distinct actor emits debarment proposal", async () => {
    const q = wire(new MemoryQueue()); registerVendorScorecardConsumers(q); await q.start();
    await q.publish(COMMANDS.vendorShowCauseIssue, msg(COMMANDS.vendorShowCauseIssue, { id: scId, vendorId: VENDOR, tenantId: TENANT, reason: "Repeated quality failures" }, ISSUER));
    await drain(q);
    const q2 = wire(new MemoryQueue()); registerVendorScorecardConsumers(q2); await q2.start();
    await q2.publish(COMMANDS.vendorShowCauseRespond, msg(COMMANDS.vendorShowCauseRespond, { id: scId, tenantId: TENANT, response: "We have corrected the process" }, ISSUER));
    await drain(q2);
    const q3 = wire(new MemoryQueue()); registerVendorScorecardConsumers(q3); await q3.start();
    await q3.publish(COMMANDS.vendorShowCauseDecide, msg(COMMANDS.vendorShowCauseDecide, { id: scId, tenantId: TENANT, decision: "Unsatisfactory", uphold: true }, DECIDER));
    await drain(q3);

    const sc = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementVendorShowCause).where(eq(procurementVendorShowCause.id, scId)))))[0];
    expect(sc?.status).toBe("upheld");
    expect(sc?.decidedBy).toBe(DECIDER);
    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, EVENTS.vendorDebarmentProposed)))));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("issuer cannot self-decide (maker-checker) — status unchanged", async () => {
    const scId2 = randomUUID();
    const q = wire(new MemoryQueue()); registerVendorScorecardConsumers(q); await q.start();
    await q.publish(COMMANDS.vendorShowCauseIssue, msg(COMMANDS.vendorShowCauseIssue, { id: scId2, vendorId: VENDOR, tenantId: TENANT, reason: "SLA breach" }, ISSUER));
    await drain(q);
    const q2 = wire(new MemoryQueue()); registerVendorScorecardConsumers(q2); await q2.start();
    await q2.publish(COMMANDS.vendorShowCauseDecide, msg(COMMANDS.vendorShowCauseDecide, { id: scId2, tenantId: TENANT, decision: "self", uphold: true }, ISSUER));
    await drain(q2);
    const sc = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementVendorShowCause).where(eq(procurementVendorShowCause.id, scId2)))))[0];
    expect(sc?.status).toBe("issued"); // decide rejected by in-consumer SoD
  });
});
