/**
 * UAT bundle 10, F93/F94 (T6-05/T6-06): finance.bill.create intake.
 *
 * F94: the GRN-to-bill and works-to-bill producers used a literal head id
 * (dddddddd-0001-...) that exists for ONE tenant, so every other tenant's bill
 * failed UNKNOWN_HEAD. Producers now send a head CODE, which finance resolves in
 * the bill tenant's own chart. Two tenants with the same code but different
 * head ids each get their OWN head.
 *
 * Refusals (unknown head code, unknown vendor) are NonRetryable (delivered once,
 * not five times), raise an error log, and emit finance.bill.rejected with a
 * stable code so the producer is told. The rejection does not mark the message
 * processed, so a re-drive after the master data is fixed still creates the bill.
 *
 * Runs against the disposable test DB (bootstrap-postgres.sh), like finance.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { eq, inArray } from "drizzle-orm";
import { financeBillRejected } from "@civitasone/events/contracts";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeDdo, financeVendors } from "../src/modules/masters/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { fyFromDate } from "../src/modules/hoa/voucher.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR = randomUUID();
const DDO = "DDO123456";
const HEAD_CODE = `B10-EXP-${randomUUID().slice(0, 6)}`;
const FY = fyFromDate(new Date().toISOString().slice(0, 10));

interface TenantFixture { tenantId: string; headId: string; vendorId: string }
const T1: TenantFixture = { tenantId: randomUUID(), headId: randomUUID(), vendorId: randomUUID() };
const T2: TenantFixture = { tenantId: randomUUID(), headId: randomUUID(), vendorId: randomUUID() };
const created: Array<{ tenantId: string; billId: string; messageId: string; correlationId: string }> = [];

async function seedTenant(t: TenantFixture, pan: string): Promise<void> {
  await scoped(t.tenantId, (tx) => tx.insert(financeHeads).values({
    id: t.headId, tenantId: t.tenantId, code: HEAD_CODE, name: "B10 expense head",
    level: 1, classification: "expenditure", hoaCode: "207101010101010101",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(t.tenantId, (tx) => tx.insert(financeDdo).values({
    tenantId: t.tenantId, ddoCode: DDO, name: "B10 DDO", createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing());
  await scoped(t.tenantId, (tx) => tx.insert(financeVendors).values({
    id: t.vendorId, tenantId: t.tenantId, name: "B10 Contractor", category: "contractor", pan,
    address: "1 Test Road", bankName: "Test Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(t.tenantId, (tx) => tx.insert(financeBudgetAllocation).values({
    id: randomUUID(), tenantId: t.tenantId, headId: t.headId, fy: FY,
    allocatedMinor: 100000000n, committedMinor: 0n, actualMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
  }));
}

/** A queue whose handlers count their deliveries, so a test can tell "dead-lettered at once" from "retried 5x". */
function countingQueue(): { q: MemoryQueue; deliveries: Map<string, number> } {
  const q = new MemoryQueue({ maxAttempts: 5 });
  const deliveries = new Map<string, number>();
  const realSubscribe = q.subscribe.bind(q);
  (q as unknown as { subscribe: typeof q.subscribe }).subscribe = ((topic: string, handler: (m: unknown) => Promise<void>, opts?: unknown) =>
    realSubscribe(topic, async (m: { messageId: string }) => {
      deliveries.set(m.messageId, (deliveries.get(m.messageId) ?? 0) + 1);
      await handler(m);
    }, opts as never)) as typeof q.subscribe;
  return { q, deliveries };
}

function billPayload(t: TenantFixture, over: Record<string, unknown> = {}): { billId: string; payload: Record<string, unknown> } {
  const billId = randomUUID();
  return {
    billId,
    payload: {
      id: billId, tenantId: t.tenantId, billNo: "W-RA-1", vendorId: t.vendorId, headCode: HEAD_CODE,
      ddoCode: DDO, grossMinor: "30000", netMinor: "30000", currency: "INR", deductions: [],
      poRef: `works_award:${randomUUID()}`, grnRef: `works_bill:${randomUUID()}`, worksBillId: randomUUID(),
      ...over,
    },
  };
}

async function publishBill(q: MemoryQueue, t: TenantFixture, payload: Record<string, unknown>, billId: string): Promise<string> {
  const messageId = randomUUID();
  const correlationId = randomUUID();
  created.push({ tenantId: t.tenantId, billId, messageId, correlationId });
  await q.publish(COMMANDS.billCreate, {
    messageId, type: COMMANDS.billCreate, tenantId: t.tenantId, actorId: ACTOR, correlationId, schemaVersion: "1.0", payload,
  });
  await q.drain();
  return correlationId;
}

beforeAll(async () => {
  await seedTenant(T1, "BBBBB1234F");
  await seedTenant(T2, "CCCCC1234F");
});

afterAll(async () => {
  for (const c of created) {
    await scoped(c.tenantId, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, c.correlationId)));
    await scoped(c.tenantId, (tx) => tx.delete(financeBills).where(eq(financeBills.id, c.billId)));
  }
  if (created.length > 0) await db.delete(processed).where(inArray(processed.messageId, created.map((c) => c.messageId)));
  for (const t of [T1, T2]) {
    await scoped(t.tenantId, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.tenantId, t.tenantId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeVendors).where(eq(financeVendors.id, t.vendorId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeDdo).where(eq(financeDdo.tenantId, t.tenantId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, t.headId)));
  }
});

describe("F94: finance.bill.create resolves the head CODE in the bill tenant's own chart", () => {
  it("two tenants with the same head code each get their own head id", async () => {
    const { q } = countingQueue();
    registerPaymentsConsumers(q);
    await q.start();
    const a = billPayload(T1);
    const b = billPayload(T2);
    await publishBill(q, T1, a.payload, a.billId);
    await publishBill(q, T2, b.payload, b.billId);
    await q.stop();

    expect(q.dlq.map((d) => d.error)).toEqual([]);
    const rowA = (await scoped(T1.tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, a.billId))))[0];
    const rowB = (await scoped(T2.tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, b.billId))))[0];
    expect(rowA?.headId).toBe(T1.headId);
    expect(rowB?.headId).toBe(T2.headId);
  });

  it("an unknown head code is refused once (NonRetryable), logged, and fed back as finance.bill.rejected", async () => {
    const { q, deliveries } = countingQueue();
    registerPaymentsConsumers(q);
    await q.start();
    const bad = billPayload(T1, { headCode: "NO-SUCH-HEAD" });
    const corr = await publishBill(q, T1, bad.payload, bad.billId);
    await q.stop();

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/UNKNOWN_HEAD_CODE/);
    expect([...deliveries.values()]).toEqual([1]);
    expect(await scoped(T1.tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, bad.billId)))).toHaveLength(0);
    const out = await scoped(T1.tenantId, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, corr)));
    const rejected = out.find((r: { eventType: string }) => r.eventType === EVENTS.billRejected);
    expect(rejected).toBeDefined();
    const payload = rejected.payload as Record<string, unknown>;
    expect(financeBillRejected.validate(payload).ok).toBe(true);
    expect(payload).toMatchObject({ billId: bad.billId, code: "UNKNOWN_HEAD_CODE", worksBillId: bad.payload.worksBillId });
  });
});

describe("F93: finance.bill.create needs a finance vendor-master uuid", () => {
  it("the old works payload (vendorId 'works_award:<id>') is a contract violation, refused once with feedback", async () => {
    const { q, deliveries } = countingQueue();
    registerPaymentsConsumers(q);
    await q.start();
    const old = billPayload(T1, { vendorId: `works_award:${randomUUID()}` });
    const corr = await publishBill(q, T1, old.payload, old.billId);
    await q.stop();

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/SCHEMA_VIOLATION/);
    expect([...deliveries.values()]).toEqual([1]);
    const out = await scoped(T1.tenantId, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, corr)));
    expect(out.find((r: { eventType: string }) => r.eventType === EVENTS.billRejected)?.payload).toMatchObject({ code: "SCHEMA_VIOLATION" });
  });

  it("a uuid vendor not in this tenant's vendor master is refused once as UNKNOWN_VENDOR; re-driving the same message after the vendor is registered creates the bill", async () => {
    const { q, deliveries } = countingQueue();
    registerPaymentsConsumers(q);
    await q.start();
    const lateVendor = randomUUID();
    const pending = billPayload(T1, { vendorId: lateVendor });
    const corr = await publishBill(q, T1, pending.payload, pending.billId);
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/UNKNOWN_VENDOR/);
    expect([...deliveries.values()]).toEqual([1]);
    const out = await scoped(T1.tenantId, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, corr)));
    expect(out.find((r: { eventType: string }) => r.eventType === EVENTS.billRejected)?.payload).toMatchObject({ code: "UNKNOWN_VENDOR" });

    // Fix the master data, then re-drive the IDENTICAL dead-lettered message: the refusal did not mark it processed.
    await scoped(T1.tenantId, (tx) => tx.insert(financeVendors).values({
      id: lateVendor, tenantId: T1.tenantId, name: "B10 late contractor", category: "contractor", pan: "DDDDD1234F",
      address: "1 Test Road", bankName: "Test Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const dead = q.dlq[0]!.msg;
    await q.publish(COMMANDS.billCreate, dead);
    await q.drain();
    // A second re-drive of the same message is a no-op (markProcessed), so no duplicate bill.
    await q.publish(COMMANDS.billCreate, dead);
    await q.drain();
    await q.stop();
    const rows = await scoped(T1.tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, pending.billId)));
    expect(rows).toHaveLength(1);
    await scoped(T1.tenantId, (tx) => tx.delete(financeBills).where(eq(financeBills.id, pending.billId)));
    await scoped(T1.tenantId, (tx) => tx.delete(financeVendors).where(eq(financeVendors.id, lateVendor)));
  });
});
