/**
 * V4-D-05 regression: inbound payment-result events validate the disbursement state transition.
 *
 * `completed` and `cancelled` are final. A late / re-sent PFMS reconcile record or a late
 * finance.payment.made failure must never overwrite a completed disbursement with `failed`, never
 * re-emit the completed/failed events, and never re-issue an EFT for a disbursement that is no longer
 * in flight.
 *
 * Runs the real consumers against the (disposable) test DB via MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments, grantDisbursements, grantPfmsRecords } from "../src/modules/disbursement/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerDisbursementConsumers } from "../src/modules/disbursement/consumer.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "2a000000-aaaa-4000-8000-0000000000f4";
const ACTOR  = "10000000-aaaa-4000-8000-0000000000f4";
const SCHEME = "2a000000-bbbb-4000-8000-0000000000f4";
const BEN    = "2a000000-dddd-4000-8000-0000000000f4";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
async function scopedQuery<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
}
async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(grantPfmsRecords).where(eq(grantPfmsRecords.tenantId, TENANT));
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT));
  }));
}
async function seed(instIds: string[], instAmount = 3_000n) {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(grantSchemes).values({
      id: SCHEME, tenantId: TENANT, code: `SCH-${SCHEME.slice(0, 8)}`, name: "V4 Scheme",
      budgetMinor: 100_000n, disbursedMinor: 0n, minAmountMinor: 0n, maxAmountMinor: 100_000n,
      currency: "INR", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    // One application per installment: installment_no is unique per application and
    // only no=1 is exempt from the UC gate, so each installment is its own no=1.
    for (const id of instIds) {
      const appId = randomUUID();
      await tx.insert(grantApplications).values({
        id: appId, tenantId: TENANT, grantNo: `G-V4-${appId.slice(0, 8)}`, schemeId: SCHEME, beneficiaryId: BEN,
        purpose: "test", amountRequestedMinor: 100_000n, amountApprovedMinor: 100_000n,
        currency: "INR", status: "approved", approvedAt: new Date(), submittedBy: ACTOR,
        approvedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(grantInstallments).values({
        id, tenantId: TENANT, applicationId: appId, installmentNo: 1,
        amountMinor: instAmount, currency: "INR", status: "pending",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
  }));
}
const wrap = (type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
  correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
});
async function send(q: Queue, topic: string, payload: Record<string, unknown>): Promise<void> {
  const m = wrap(topic, payload);
  await q.publish(topic, m);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await scopedQuery((tx) => tx.select().from(processed).where(eq(processed.messageId, m.messageId)));
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`message on ${topic} was never processed`);
}
const eventCount = async (t: string) =>
  (await scopedQuery((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))).filter((r) => r.eventType === t).length;

async function boot(): Promise<Queue> {
  const q = wireTenantAwareQueue(new MemoryQueue()); registerDisbursementConsumers(q); await q.start(); return q;
}

beforeEach(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

const setStatus = (id: string, status: string) => runWithTenant(TENANT, () => db.transaction(async (tx) => {
  await tx.update(grantDisbursements).set({ status }).where(eq(grantDisbursements.id, id));
}));
const statusOf = async (id: string) =>
  (await scopedQuery((tx) => tx.select().from(grantDisbursements).where(eq(grantDisbursements.id, id))))[0]!.status;

async function paidDisbursement(q: Queue): Promise<{ inst: string; disb: string }> {
  const inst = randomUUID(); const disb = randomUUID();
  await seed([inst]);
  await send(q, COMMANDS.disbursementInitiate, { id: disb, tenantId: TENANT, installmentId: inst, mode: "PFMS" });
  return { inst, disb };
}

describe("V4-D-05 -- disbursement result events respect the state machine", () => {
  it("a late PFMS reconcile 'failed' never overwrites a completed disbursement", async () => {
    const q = await boot();
    const { disb } = await paidDisbursement(q);
    const txn = `PFMS-MOCK-${disb}`;
    await send(q, COMMANDS.pfmsReconcile, { tenantId: TENANT, records: [{ pfmsTxnId: txn, status: "completed" }] });
    expect(await statusOf(disb)).toBe("completed");
    await send(q, COMMANDS.pfmsReconcile, { tenantId: TENANT, records: [{ pfmsTxnId: txn, status: "failed" }] });
    await q.stop();

    expect(await statusOf(disb)).toBe("completed");
    expect(await eventCount("grant.disbursement.failed")).toBe(0);
  });

  it("a re-sent PFMS reconcile 'completed' does not re-emit the completed event", async () => {
    const q = await boot();
    const { disb } = await paidDisbursement(q);
    const rec = { tenantId: TENANT, records: [{ pfmsTxnId: `PFMS-MOCK-${disb}`, status: "completed" }] };
    await send(q, COMMANDS.pfmsReconcile, rec);
    await send(q, COMMANDS.pfmsReconcile, rec);
    await q.stop();

    expect(await eventCount("grant.disbursement.completed")).toBe(1);
  });

  it("a finance.payment.made failure for a completed disbursement does not retry, re-pay, or change state", async () => {
    const q = await boot();
    const { disb } = await paidDisbursement(q);
    await setStatus(disb, "completed");
    const eftBefore = await eventCount("finance.payment.eft.initiate");
    await send(q, CONSUMED_EVENTS.financePaid, { disbursementId: disb, outcome: "failure" });
    await q.stop();

    expect(await statusOf(disb)).toBe("completed");
    expect(await eventCount("finance.payment.eft.initiate")).toBe(eftBefore);
  });

  it("a finance.payment.made failure for a cancelled disbursement does not resurrect it", async () => {
    const q = await boot();
    const { disb } = await paidDisbursement(q);
    await setStatus(disb, "cancelled");
    const eftBefore = await eventCount("finance.payment.eft.initiate");
    await send(q, CONSUMED_EVENTS.financePaid, { disbursementId: disb, outcome: "failure" });
    await q.stop();

    expect(await statusOf(disb)).toBe("cancelled");
    expect(await eventCount("finance.payment.eft.initiate")).toBe(eftBefore);
  });

  it("an in-flight disbursement still retries on failure and completes on success (happy path unchanged)", async () => {
    const q = await boot();
    const { disb } = await paidDisbursement(q);
    const eftBefore = await eventCount("finance.payment.eft.initiate");
    await send(q, CONSUMED_EVENTS.financePaid, { disbursementId: disb, outcome: "failure" });
    expect(await statusOf(disb)).toBe("initiated");
    expect(await eventCount("finance.payment.eft.initiate")).toBe(eftBefore + 1);
    await send(q, CONSUMED_EVENTS.financePaid, { disbursementId: disb, outcome: "success" });
    await q.stop();

    expect(await statusOf(disb)).toBe("completed");
  });
});
