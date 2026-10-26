/**
 * V4-D-03 regression: an installment is disbursed at most once.
 *
 *  D-03: an installment may be paid at most once -- a second initiate while a
 *        disbursement for it is pending approval / initiated / completed is a
 *        duplicate, and must not reserve scheme budget or insert a second row.
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
import { COMMANDS } from "../src/topics.js";

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
const eventCount = async (t: string) =>
  (await scopedQuery((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))).filter((r) => r.eventType === t).length;

async function boot(): Promise<Queue> {
  const q = wireTenantAwareQueue(new MemoryQueue()); registerDisbursementConsumers(q); await q.start(); return q;
}

beforeEach(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("V4-D-03 -- an installment is disbursed at most once", () => {
  it("rejects a second approval-gated initiate for the same installment (no 2nd row, no 2nd reservation)", async () => {
    const INST = randomUUID(); await seed([INST]);
    const q = await boot();
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: INST, mode: "PFMS", requireApproval: true });
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: INST, mode: "PFMS", requireApproval: true });
    await q.stop();

    expect(await disbRows(INST)).toHaveLength(1);
    expect(await schemeDisbursed()).toBe(3_000n);
    expect(await eventCount("grant.disbursement.duplicate")).toBe(1);
  });

  it("rejects an immediate initiate while a gated disbursement for the installment is pending approval", async () => {
    const INST = randomUUID(); await seed([INST]);
    const q = await boot();
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: INST, mode: "PFMS", requireApproval: true });
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: INST, mode: "PFMS" });
    await q.stop();

    expect(await disbRows(INST)).toHaveLength(1);
    expect(await schemeDisbursed()).toBe(3_000n);
    expect(await eventCount("finance.payment.eft.initiate")).toBe(0);
  });
});

