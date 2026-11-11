/**
 * M10: a tender award is held for a finance sanction above Rs 1,000 (SANCTION_REQUIRED).
 * For a tenant without the Finance module (local approval mode) there is no
 * sanction to cite, so the award goes through and the PO it raises is created
 * without one. A tenant with Finance keeps the hold exactly as before
 * (tender-lifecycle.test.ts pins that path in detail).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler, SubscribeOptions } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementTenders, procurementTenderBids, procurementTenderFinancialBids } from "../src/modules/tender/schema.js";
import { procurementVendors, procurementEmpanelment } from "../src/modules/vendor/schema.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerTenderConsumers } from "../src/modules/tender/consumer.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { setModuleKeyFetcher } from "../src/shared/tenant-modules.js";
import { COMMANDS } from "../src/topics.js";

const LOCAL = randomUUID();
const FINANCE = randomUUID();
const CREATOR = randomUUID();
const TECH_EVAL = randomUUID();
const AWARDER = randomUUID();
const VENDOR = randomUUID();
const hasFinance = new Map<string, boolean>([[LOCAL, false], [FINANCE, true]]);

const msg = (tenantId: string, type: string, payload: Record<string, unknown>, actorId = CREATOR) => ({
  messageId: randomUUID(), type, tenantId, actorId, correlationId: `corr-${type}`, schemaVersion: "1.0", payload,
});
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler, options?: SubscribeOptions) => raw(topic, withTenantConsumer(handler) as Handler, options)) as typeof q.subscribe;
  return q;
}
async function send(tenantId: string, type: string, payload: Record<string, unknown>, actorId = CREATOR): Promise<void> {
  const q = wire(new MemoryQueue());
  registerTenderConsumers(q);
  registerPoConsumers(q);
  await q.start();
  await q.publish(type, msg(tenantId, type, payload, actorId));
  await (q as MemoryQueue).drain();
  await q.stop();
}
const tenderOf = (tenantId: string, id: string) => runWithTenant(tenantId, () => db.transaction(async (tx) =>
  (await tx.select().from(procurementTenders).where(eq(procurementTenders.id, id)))[0]));

/** create -> publish -> one bid of Rs 3,50,000 -> technical evaluation -> financial opening; ready to award. */
async function tenderReadyToAward(tenantId: string): Promise<{ tenderId: string; indentId: string }> {
  const tenderId = randomUUID();
  const bidId = randomUUID();
  const indentId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({ id: VENDOR, tenantId, name: "Award Co", vendorType: "registered", mse: false, msme: false, kycStatus: "verified", createdBy: CREATOR, updatedBy: CREATOR }).onConflictDoNothing();
    await tx.insert(procurementIndents).values({
      id: indentId, tenantId, indentNo: `IND-M10T-${indentId.slice(-6)}`, department: "Admin", purpose: "M10 tender award",
      totalMinor: 35_000_000n, committedMinor: 0n, currency: "INR", status: "approved", createdBy: CREATOR, updatedBy: CREATOR,
    });
  }));
  await send(tenantId, COMMANDS.tenderCreate, { id: tenderId, tenantId, title: "Supply of Laptops", type: "open", estimatedMinor: 40_000_000, emdAmountMinor: 0, bidClosingDate: "2999-12-31", indentRef: `procurement_indent:${indentId}` });
  await send(tenantId, COMMANDS.tenderPublish, { id: tenderId, tenantId });
  await send(tenantId, COMMANDS.tenderBidSubmit, { id: bidId, tenderId, tenantId, vendorId: VENDOR, vendorName: "Award Co", technicalScore: 90, financialAmountMinor: 35_000_000 });
  await send(tenantId, COMMANDS.tenderTechEvaluate, { id: tenderId, tenantId, results: [{ bidId, qualified: true, score: 90 }] }, TECH_EVAL);
  await send(tenantId, COMMANDS.tenderFinancialOpen, { id: tenderId, tenantId }, TECH_EVAL);
  expect((await tenderOf(tenantId, tenderId))?.status).toBe("financial_evaluation");
  return { tenderId, indentId };
}

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, tenantId));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, tenantId));
    await tx.delete(procurementTenderFinancialBids).where(eq(procurementTenderFinancialBids.tenantId, tenantId));
    await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, tenantId));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, tenantId));
    await tx.delete(procurementEmpanelment).where(eq(procurementEmpanelment.tenantId, tenantId));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, tenantId));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, tenantId));
  }));
}

beforeAll(() => { setModuleKeyFetcher(async (tid) => (hasFinance.get(tid) === false ? ["procurement"] : ["procurement", "finance"])); });
afterAll(async () => {
  setModuleKeyFetcher();
  await wipe(LOCAL);
  await wipe(FINANCE);
  await sqlClient.end();
});

describe("tender award without Finance (local approval mode)", () => {
  it("a Rs 3,50,000 award with no sanction goes through, and the PO it raises is created without one, with no call to finance-service", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 503 }));
    const { tenderId } = await tenderReadyToAward(LOCAL);
    await send(LOCAL, COMMANDS.tenderAward, { id: tenderId, tenantId: LOCAL }, AWARDER);
    const t = await tenderOf(LOCAL, tenderId);
    expect(t?.status).toBe("awarded");
    expect(t?.awardedVendorId).toBe(VENDOR);

    // The award raised a PO create command; deliver it the way the worker would.
    const cmd = (await runWithTenant(LOCAL, () => db.transaction(async (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, LOCAL)))))
      .find((r) => r.eventType === COMMANDS.poCreate);
    expect(cmd).toBeDefined();
    const payload = cmd!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("sanctionRef");
    await send(LOCAL, COMMANDS.poCreate, payload, AWARDER);
    const pos = await runWithTenant(LOCAL, () => db.transaction(async (tx) => tx.select().from(procurementPos).where(eq(procurementPos.tenantId, LOCAL))));
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ status: "draft", sanctionRef: null, totalMinor: 35_000_000n });
    expect((fetchSpy.mock.calls as unknown[][]).map((c) => String(c[0])).filter((u) => u.includes("sanctions"))).toEqual([]);
    fetchSpy.mockRestore();
  });
});

describe("tender award with Finance (every current tenant)", () => {
  it("a Rs 3,50,000 award with no sanction is still held: the tender stays unawarded", async () => {
    const { tenderId } = await tenderReadyToAward(FINANCE);
    await send(FINANCE, COMMANDS.tenderAward, { id: tenderId, tenantId: FINANCE }, AWARDER);
    const t = await tenderOf(FINANCE, tenderId);
    expect(t?.status).toBe("financial_evaluation");
    expect(t?.awardedVendorId).toBeNull();
  });
});
