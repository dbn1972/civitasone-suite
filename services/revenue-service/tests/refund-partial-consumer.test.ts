/**
 * Owner decision #1 — consumer half. DB-backed: a partial refundCreate stores
 * the partial amount (not the receipt amount); an over-balance amount is
 * refused in the consumer too (defence in depth behind the 422 route check);
 * no amount keeps the full-refund default.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { receipts, refunds } from "../src/modules/collection/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e5000000-0000-4000-8000-000000000001";
const ASSESSEE = "e5000000-0000-4000-8000-0000000000ee";
const DEMAND = "e5000000-0000-4000-8000-0000000de111";
const MAKER = "e5000000-0000-4000-8000-00000000a000";
const RECEIPT = "e5000000-0000-4000-8000-0000000000c1";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
const msg = (payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type: COMMANDS.refundCreate, tenantId: TENANT, actorId: MAKER,
  correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(refunds).where(eq(refunds.tenantId, TENANT));
    await tx.delete(receipts).where(eq(receipts.tenantId, TENANT));
  }));
}
async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(receipts).values({
      id: RECEIPT, tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, amountMinor: 100000n,
      channel: "counter", reference: "REF-PARTIAL", receiptNo: "RCT-T-1", createdBy: MAKER, updatedBy: MAKER,
    });
  }));
}
async function run(payload: Record<string, unknown>) {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerCollectionConsumers(q);
  await q.start();
  await q.publish(COMMANDS.refundCreate, msg(payload));
  await q.drain();
  await q.stop();
  return runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(refunds).where(eq(refunds.tenantId, TENANT))));
}

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("refundCreate consumer — partial amount (owner decision #1)", () => {
  it("stores the partial amount on the pending refund", async () => {
    const rows = await run({ receiptId: RECEIPT, reason: "part", amountMinor: "25000" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountMinor).toBe(25000n);
    expect(rows[0]!.status).toBe("pending");
  });
  it("defaults to the full receipt amount when no amount is sent", async () => {
    const rows = await run({ receiptId: RECEIPT, reason: "full" });
    expect(rows[0]!.amountMinor).toBe(100000n);
  });
  it("refuses an amount above the receipt (no refund row written)", async () => {
    let threw = false;
    let rows: unknown[] = [];
    try { rows = await run({ receiptId: RECEIPT, reason: "over", amountMinor: "100001" }); } catch { threw = true; }
    expect(threw || rows.length === 0).toBe(true);
    const after = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(refunds).where(eq(refunds.tenantId, TENANT))));
    expect(after).toHaveLength(0);
  });
});
