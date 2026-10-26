/**
 * V4-D-04 regression: a failed grant disbursement releases its budget and re-opens the installment.
 *
 *  D-04: a terminally failed disbursement (retries exhausted, or a failed PFMS
 *        reconcile record) must release its scheme-budget reservation and put
 *        the installment back to `pending` so it can be re-released -- exactly
 *        once, even if the failure event is delivered again.
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
const disbRows = (instId: string) => scopedQuery((tx) =>
  tx.select().from(grantDisbursements).where(eq(grantDisbursements.installmentId, instId)));
const instStatus = async (id: string) =>
  (await scopedQuery((tx) => tx.select().from(grantInstallments).where(eq(grantInstallments.id, id))))[0]!.status;
const schemeDisbursed = async () =>
  (await scopedQuery((tx) => tx.select().from(grantSchemes).where(eq(grantSchemes.id, SCHEME))))[0]!.disbursedMinor;

async function boot(): Promise<Queue> {
  const q = wireTenantAwareQueue(new MemoryQueue()); registerDisbursementConsumers(q); await q.start(); return q;
}

beforeEach(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("V4-D-04 -- a failed disbursement releases its budget and re-opens the installment", () => {
  it("pfms reconcile 'failed' releases the reservation once, reverts the installment, and allows re-release", async () => {
    const A = randomUUID(); const B = randomUUID(); await seed([A, B]);
    const q = await boot();
    const dA = randomUUID(); const dB = randomUUID();
    await send(q, COMMANDS.disbursementInitiate, { id: dA, tenantId: TENANT, installmentId: A, mode: "PFMS" });
    await send(q, COMMANDS.disbursementInitiate, { id: dB, tenantId: TENANT, installmentId: B, mode: "PFMS" });
    expect(await schemeDisbursed()).toBe(6_000n);

    const rec = { tenantId: TENANT, records: [{ pfmsTxnId: `PFMS-MOCK-${dA}`, status: "failed" }] };
    await send(q, COMMANDS.pfmsReconcile, rec);
    expect((await disbRows(A))[0]!.status).toBe("failed");
    expect(await schemeDisbursed()).toBe(3_000n);   // only A's 3000 released
    expect(await instStatus(A)).toBe("pending");
    expect(await instStatus(B)).toBe("disbursed");

    // The same failure re-delivered (fresh messageId) must NOT release B's reservation too.
    await send(q, COMMANDS.pfmsReconcile, rec);
    expect(await schemeDisbursed()).toBe(3_000n);

    // The installment can be released again.
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: A, mode: "PFMS" });
    await q.stop();
    expect(await schemeDisbursed()).toBe(6_000n);
    expect(await instStatus(A)).toBe("disbursed");
  });

  it("finance.payment.made outcome=failure with retries exhausted releases the reservation and reverts the installment", async () => {
    const A = randomUUID(); const B = randomUUID(); await seed([A, B]);
    const q = await boot();
    const dA = randomUUID(); const dB = randomUUID();
    await send(q, COMMANDS.disbursementInitiate, { id: dA, tenantId: TENANT, installmentId: A, mode: "PFMS" });
    await send(q, COMMANDS.disbursementInitiate, { id: dB, tenantId: TENANT, installmentId: B, mode: "PFMS" });
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.update(grantDisbursements).set({ retryCount: 3 }).where(eq(grantDisbursements.id, dA));
    }));

    await send(q, CONSUMED_EVENTS.financePaid, { disbursementId: dA, outcome: "failure" });
    await q.stop();

    expect((await disbRows(A))[0]!.status).toBe("failed");
    expect(await schemeDisbursed()).toBe(3_000n);
    expect(await instStatus(A)).toBe("pending");
    expect(await instStatus(B)).toBe("disbursed");
  });
});
