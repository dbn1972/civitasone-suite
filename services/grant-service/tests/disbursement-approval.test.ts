/**
 * R14 — approval-gated grant disbursement: approval precedes payment.
 *
 *  - requireApproval=true creates a `pending_approval` disbursement that does
 *    NOT pay (no finance.payment.eft.initiate), but DOES reserve scheme budget
 *  - eOffice approval emits exactly ONE EFT payout and marks the installment disbursed
 *  - eOffice rejection releases the reserved scheme budget and cancels (no EFT)
 *  - an already-paid (eft_emitted) disbursement is never re-paid on approval
 *
 * Runs the real disbursement consumers against the dev DB via MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments, grantDisbursements, grantPfmsRecords } from "../src/modules/disbursement/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerDisbursementConsumers } from "../src/modules/disbursement/consumer.js";
import { registerEOfficeDecisionConsumers } from "../src/modules/disbursement/eoffice-consumer.js";
import { COMMANDS } from "../src/topics.js";

const EFT = "finance.payment.eft.initiate";
const TENANT = "2a000000-aaaa-4000-8000-0000000000e1";
const ACTOR  = "10000000-aaaa-4000-8000-0000000000e1";
const SCHEME = "2a000000-bbbb-4000-8000-0000000000e1";
const APP    = "2a000000-cccc-4000-8000-0000000000e1";
const BEN    = "2a000000-dddd-4000-8000-0000000000e1";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/** Helper: scoped read within tenant transaction (test assertion reads) */
async function scopedQuery<T>(tenant: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
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

async function seed(budget: bigint, approved: bigint, instAmount: bigint, instId: string) {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(grantSchemes).values({
      id: SCHEME, tenantId: TENANT, code: `SCH-${SCHEME.slice(0, 8)}`, name: "R14 Scheme",
      budgetMinor: budget, disbursedMinor: 0n, minAmountMinor: 0n, maxAmountMinor: budget,
      currency: "INR", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantApplications).values({
      id: APP, tenantId: TENANT, grantNo: "G-R14", schemeId: SCHEME, beneficiaryId: BEN,
      purpose: "test", amountRequestedMinor: approved, amountApprovedMinor: approved,
      currency: "INR", status: "approved", approvedAt: new Date(), submittedBy: ACTOR,
      approvedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantInstallments).values({
      id: instId, tenantId: TENANT, applicationId: APP, installmentNo: 1,
      amountMinor: instAmount, currency: "INR", status: "pending",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

const wrap = (type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
  correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
});

function decided(disbId: string, decision: "approved" | "rejected") {
  const messageId = randomUUID();
  return {
    envelope: {
      messageId, type: "grant.disbursement.file_decided", tenantId: TENANT, actorId: ACTOR,
      correlationId: `corr-${disbId.slice(0, 6)}`, schemaVersion: "1.0",
      payload: {
        fileId: randomUUID(), fileNo: "EST/GR/2026/1", refType: "grant_disbursement",
        refId: disbId, decision, decidedBy: ACTOR, decidedAt: new Date().toISOString(),
      },
    },
    messageId,
  };
}

async function eftCount(): Promise<number> {
  const rows = await scopedQuery(TENANT, (tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return rows.filter((r) => r.eventType === EFT).length;
}
async function disb(id: string) {
  return (await scopedQuery(TENANT, (tx) =>
    tx.select().from(grantDisbursements).where(eq(grantDisbursements.id, id))))[0];
}
async function schemeDisbursed(): Promise<bigint> {
  return (await scopedQuery(TENANT, (tx) =>
    tx.select().from(grantSchemes).where(eq(grantSchemes.id, SCHEME))))[0]!.disbursedMinor;
}
async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); }
}

beforeEach(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("R14 — approval-gated disbursement (approval before payment)", () => {
  it("requireApproval holds in pending_approval, reserves budget, and does NOT pay", async () => {
    const INST = randomUUID(); const DISB = randomUUID();
    await seed(10_000n, 10_000n, 3_000n, INST);
    const q = wireTenantAwareQueue(new MemoryQueue()); registerDisbursementConsumers(q); await q.start();

    const m = wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST, mode: "PFMS", requireApproval: true });
    await q.publish(COMMANDS.disbursementInitiate, m);
    await waitFor(async () => (await scopedQuery(TENANT, (tx) => tx.select().from(processed).where(eq(processed.messageId, m.messageId)))).length === 1);
    await q.stop();

    const d = await disb(DISB);
    expect(d?.status).toBe("pending_approval");
    expect(d?.eftEmitted).toBe(false);
    expect(await eftCount()).toBe(0);                 // NOT paid
    expect(await schemeDisbursed()).toBe(3_000n);     // budget reserved
    const inst = (await scopedQuery(TENANT, (tx) => tx.select().from(grantInstallments).where(eq(grantInstallments.id, INST))))[0];
    expect(inst?.status).toBe("pending");             // installment not yet disbursed
  });

  it("eOffice approval pays exactly once and marks the installment disbursed", async () => {
    const INST = randomUUID(); const DISB = randomUUID();
    await seed(10_000n, 10_000n, 3_000n, INST);
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDisbursementConsumers(q); registerEOfficeDecisionConsumers(q); await q.start();

    const create = wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST, mode: "PFMS", requireApproval: true });
    await q.publish(COMMANDS.disbursementInitiate, create);
    await waitFor(async () => (await scopedQuery(TENANT, (tx) => tx.select().from(processed).where(eq(processed.messageId, create.messageId)))).length === 1);

    const dec = decided(DISB, "approved");
    await q.publish("grant.disbursement.file_decided", dec.envelope);
    await waitFor(async () => (await scopedQuery(TENANT, (tx) => tx.select().from(processed).where(eq(processed.messageId, dec.messageId)))).length === 1);
    await q.stop();

    const d = await disb(DISB);
    expect(d?.status).toBe("initiated");
    expect(d?.eftEmitted).toBe(true);
    expect(await eftCount()).toBe(1);                 // paid exactly once, only after approval
    const inst = (await scopedQuery(TENANT, (tx) => tx.select().from(grantInstallments).where(eq(grantInstallments.id, INST))))[0];
    expect(inst?.status).toBe("disbursed");
  });

  it("eOffice rejection releases the reserved budget and pays nothing", async () => {
    const INST = randomUUID(); const DISB = randomUUID();
    await seed(10_000n, 10_000n, 3_000n, INST);
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDisbursementConsumers(q); registerEOfficeDecisionConsumers(q); await q.start();

    const create = wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST, mode: "PFMS", requireApproval: true });
    await q.publish(COMMANDS.disbursementInitiate, create);
    await waitFor(async () => (await scopedQuery(TENANT, (tx) => tx.select().from(processed).where(eq(processed.messageId, create.messageId)))).length === 1);
    expect(await schemeDisbursed()).toBe(3_000n);

    const dec = decided(DISB, "rejected");
    await q.publish("grant.disbursement.file_decided", dec.envelope);
    await waitFor(async () => (await scopedQuery(TENANT, (tx) => tx.select().from(processed).where(eq(processed.messageId, dec.messageId)))).length === 1);
    await q.stop();

    const d = await disb(DISB);
    expect(d?.status).toBe("cancelled");
    expect(await eftCount()).toBe(0);                 // never paid
    expect(await schemeDisbursed()).toBe(0n);         // budget released
  });

  it("an already-paid disbursement (eft_emitted) is NOT re-paid on approval", async () => {
    const INST = randomUUID(); const DISB = randomUUID();
    await seed(10_000n, 10_000n, 3_000n, INST);
    // simulate the legacy path: a disbursement already paid, then flipped to pending_approval
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantDisbursements).values({
        id: DISB, tenantId: TENANT, installmentId: INST, amountMinor: 3_000n, currency: "INR",
        mode: "PFMS", pfmsTxnId: `PFMS-${DISB}`, status: "pending_approval", eftEmitted: true,
        retryCount: 0, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const q = wireTenantAwareQueue(new MemoryQueue()); registerEOfficeDecisionConsumers(q); await q.start();

    const dec = decided(DISB, "approved");
    await q.publish("grant.disbursement.file_decided", dec.envelope);
    await waitFor(async () => (await scopedQuery(TENANT, (tx) => tx.select().from(processed).where(eq(processed.messageId, dec.messageId)))).length === 1);
    await q.stop();

    const d = await disb(DISB);
    expect(d?.status).toBe("initiated");
    expect(await eftCount()).toBe(0);                 // no NEW payout — guarded by eft_emitted
  });
});

describe("SoD — separation of duties on disbursement submit-approval (defence in depth)", () => {
  it("creator==submitter-for-approval -> 403 SOD_VIOLATION", async () => {
    const INST = randomUUID(); const DISB = randomUUID();
    await seed(10_000n, 10_000n, 3_000n, INST);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantDisbursements).values({
        id: DISB, tenantId: TENANT, installmentId: INST, amountMinor: 3_000n, currency: "INR",
        mode: "PFMS", pfmsTxnId: `PFMS-${DISB}`, status: "initiated", eftEmitted: false,
        retryCount: 0, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const { buildApp } = await import("../src/app.js");
    const { signToken } = await import("@civitasone/auth");
    const app = await buildApp();
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_officer"], sid: "s" }, process.env.JWT_SECRET as string);
    const res = await app.inject({
      method: "POST", url: `/v1/grants/disbursements/${DISB}/submit-approval`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_VIOLATION");
  });
});
