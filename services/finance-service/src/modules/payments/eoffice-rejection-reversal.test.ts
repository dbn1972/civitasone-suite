/**
 * V4-D-02 -- an eOffice REJECTION of a finance payment must undo what
 * paymentInitiate already posted: bill "paid", committed->actual settlement,
 * the AP/Bank GL journal and the cash-book OUT row. Real Postgres, no mocks.
 * Fresh random tenant per run (finance rows are append-only for finance_svc).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type CommandEnvelope } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { eq, sql } from "drizzle-orm";
import { db, sqlClient } from "../../shared/db.js";
import { registerPaymentsConsumers } from "./consumer.js";
import { registerPaymentEOfficeDecisionConsumers } from "./eoffice-consumer.js";
import { financeBills, financePayments } from "./schema.js";
import { financeHeads } from "../budget/schema.js";
import { financeBudgetAllocation } from "../budget/allocation-schema.js";
import { outboxMessages } from "../../shared/outbox.js";
import { deterministicId } from "../gl/spine.js";
import { fyFromDate } from "../hoa/voucher.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";

const TENANT = randomUUID();
const scopedTo = <T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> =>
  withTenantScope(db, tenantId, fn as never) as Promise<T>;
const scoped = scopedTo;
const CREATOR = randomUUID();
const PASSER = randomUUID();
const PAYER = randomUUID();
const DECIDER = randomUUID();
const NET = 250000n;
const BILL_DATE = "2026-09-15";

afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))).catch(() => {});
  await sqlClient.end();
});

const apId = randomUUID();
const bankId = randomUUID();
beforeAll(async () => {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: apId, tenantId: TENANT, code: "2050", name: "AP control", level: 1, createdBy: CREATOR, updatedBy: CREATOR },
    { id: bankId, tenantId: TENANT, code: "1100", name: "Bank", level: 1, createdBy: CREATOR, updatedBy: CREATOR },
  ]));
});

// Production createQueue() runs every handler under the message tenant (RLS GUC); MemoryQueue does not,
// and eoffice-consumer.ts subscribes directly, so mirror the production wrapper here.
const tenantScoped = (q: MemoryQueue): Queue => ({
  subscribe: <T>(topic: string, h: (m: CommandEnvelope<T>) => Promise<void>) =>
    q.subscribe<T>(topic, async (m) => { await runWithTenant(m.tenantId, () => h(m)); }),
}) as unknown as Queue;

async function seed() {
  const expId = randomUUID();
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values(
    { id: expId, tenantId: TENANT, code: `EXP-${expId.slice(0, 6)}`, name: "Expense", level: 2, createdBy: CREATOR, updatedBy: CREATOR },
  ));
  const allocId = randomUUID();
  await scoped(TENANT, (tx) => tx.insert(financeBudgetAllocation).values({
    id: allocId, tenantId: TENANT, headId: expId, fy: fyFromDate(BILL_DATE),
    allocatedMinor: 1_000_000n, committedMinor: NET, actualMinor: 0n, createdBy: CREATOR, updatedBy: CREATOR,
  }));
  const billId = randomUUID();
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: billId, tenantId: TENANT, billNo: `B-${billId.slice(0, 6)}`, vendorId: randomUUID(), headId: expId,
    grossMinor: NET, netMinor: NET, currency: "INR", deductions: [], billDate: BILL_DATE,
    stage: "pay", status: "passed", createdBy: CREATOR, updatedBy: PASSER,
  }));
  return { allocId, billId };
}

const env = (type: string, actorId: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${randomUUID().slice(0, 8)}`,
  schemaVersion: "1.0", payload,
});

async function run(decision: "approved" | "rejected" | "returned") {
  const { allocId, billId } = await seed();
  const paymentId = randomUUID();
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerPaymentsConsumers(q);
  registerPaymentEOfficeDecisionConsumers(tenantScoped(q));
  await q.start();
  await q.publish(COMMANDS.paymentInitiate, env(COMMANDS.paymentInitiate, PAYER, {
    id: paymentId, tenantId: TENANT, billId, ddoCode: "DDO12345", mode: "NEFT", amountMinor: NET.toString(),
  }));
  await q.drain();
  await q.publish(CONSUMED_EVENTS.paymentFileDecided, env(CONSUMED_EVENTS.paymentFileDecided, DECIDER, {
    fileId: randomUUID(), fileNo: "FIN/2026/PAY/1", refType: "finance_payment", refId: paymentId,
    decision, decidedBy: DECIDER, decidedAt: "2026-09-16T10:00:00Z",
  }));
  await q.drain();
  await q.stop();
  expect(q.dlq.map((d) => d.error)).toEqual([]);

  const [payment] = await scoped(TENANT, (tx) => tx.select().from(financePayments).where(eq(financePayments.id, paymentId)));
  const [bill] = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, billId)));
  const [alloc] = await scoped(TENANT, (tx) => tx.select().from(financeBudgetAllocation).where(eq(financeBudgetAllocation.id, allocId)));
  const cash = await scoped(TENANT, (tx) => tx.execute(sql`
    SELECT receipt_minor::text AS r, payment_minor::text AS p FROM gl.finance_cash_book
     WHERE tenant_id = ${TENANT}::uuid AND reference IN (${`payment:${paymentId}`}, ${`payment-reversal:${paymentId}`})
     ORDER BY created_at`)) as unknown as { r: string; p: string }[];
  const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  const ours = [deterministicId(`payment:${paymentId}`), deterministicId(`payment-reversal:${paymentId}`)];
  const journals = outbox.filter((m) => m.topic === COMMANDS.journalPost && ours.includes((m.payload as { id: string }).id))
    .map((m) => m.payload as { lines: { accountCode: string; debitMinor: string; creditMinor: string }[] });
  // finance.payment.made is emitted once, at payment time (paymentInitiate); the eOffice decision must not add another.
  const made = outbox.filter((m) => m.topic === "finance.payment.made" && (m.payload as { paymentId?: string }).paymentId === paymentId);
  return { payment, bill, alloc, cash, outbox, journals, made };
}

describe("eOffice rejection of an already-posted payment (V4-D-02)", () => {
  it("rejected: payment cancelled AND bill, appropriation, GL and cash book are all reversed", async () => {
    const r = await run("rejected");
    expect(r.payment?.status).toBe("cancelled");
    expect(r.bill?.status).toBe("passed");
    expect(r.alloc?.committedMinor).toBe(NET);
    expect(r.alloc?.actualMinor).toBe(0n);
    expect(r.made).toHaveLength(1);
    // Cash book: the OUT row is offset by an IN row of the same amount.
    expect(r.cash.map((c) => [c.r, c.p])).toEqual([["0", NET.toString()], [NET.toString(), "0"]]);
    // GL: the original Dr AP / Cr Bank journal plus its Dr Bank / Cr AP mirror.
    expect(r.journals).toHaveLength(2);
    const net = new Map<string, bigint>();
    for (const j of r.journals) for (const l of j.lines) {
      net.set(l.accountCode, (net.get(l.accountCode) ?? 0n) + BigInt(l.debitMinor) - BigInt(l.creditMinor));
    }
    expect(net.get(apId)).toBe(0n);
    expect(net.get(bankId)).toBe(0n);
  });

  it("approved: payment released, nothing reversed", async () => {
    const r = await run("approved");
    expect(r.payment?.status).toBe("released");
    expect(r.bill?.status).toBe("paid");
    expect(r.alloc?.actualMinor).toBe(NET);
    expect(r.cash).toHaveLength(1);
    expect(r.journals).toHaveLength(1);
    // Full pay -> approve flow: exactly ONE finance.payment.made overall (the payment-time emit; none on approval).
    expect(r.made).toHaveLength(1);
  });

  it("returned: no state change, nothing reversed", async () => {
    const r = await run("returned");
    expect(r.payment?.status).toBe("initiated");
    expect(r.bill?.status).toBe("paid");
    expect(r.cash).toHaveLength(1);
    expect(r.made).toHaveLength(1);
  });
});
