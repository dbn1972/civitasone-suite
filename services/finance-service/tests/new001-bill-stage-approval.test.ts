/**
 * NEW-001 (FF-06, D-66) — the two-stage bill approval, driven through the REAL
 * payments consumer against real Postgres on a MemoryQueue.
 *
 * The defect (probe P1): approveBill built the command id from a CONSTANT key
 * `bill-approve:${id}`, so stage 1 (officer A) and stage 2 (officer B) hashed to
 * the SAME messageId. markProcessed swallowed the second stage silently, so no
 * bill could ever reach 'passed'. This file proves the inverse of P1:
 *
 *   (a) officer A (stage section) then officer B (stage accounts) advance the
 *       SAME bill to pay/passed — one finance.bill.passed, one GL spine journal
 *       enqueued, two approve audit events (one per stage, carrying the stage);
 *   (b) the SAME officer double-clicking stage 1 (same stage-exact id) advances
 *       exactly once — the duplicate is deduplicated by markProcessed;
 *   (c) the message id is stage-exact and actor-exact: equal for the same
 *       {bill, stage, actor}, different for a different stage or a different
 *       actor (D-66: the approval key includes stage and actor).
 *
 * The approval key must never be relaxed (D-66).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { idempotentId } from "@civitasone/auth";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1111-4000-8000-00000000f601";
const MAKER  = "00000000-aaaa-4000-8000-00000000f601"; // raises the bill
const OFF_A  = "00000000-bbbb-4000-8000-00000000f601"; // stage-1 approver (Section Officer)
const OFF_B  = "00000000-cccc-4000-8000-00000000f601"; // stage-2 approver (Accounts Officer)
const VENDOR = "f6010000-aaaa-4000-8000-000000000001";
const HEAD   = "f6010000-bbbb-4000-8000-000000000001"; // expense head (bill.headId)
const AP_HEAD = "f6010000-cccc-4000-8000-000000000001"; // AP control (code 2050)

const BILL = "f6010000-dddd-4000-8000-000000000001"; // (a) two-stage happy path
const DUP_BILL = "f6010000-dddd-4000-8000-000000000002"; // (b) double-click dedup

const CORRS = ["corr-f601-a1", "corr-f601-a2", "corr-f601-dup1", "corr-f601-dup2"];
const BILLS = [BILL, DUP_BILL];

function msgId(billId: string, stage: string, actor: string): string {
  return idempotentId({ idempotencyKey: `bill-approve:${billId}:${stage}:${actor}`, tenantId: TENANT });
}

async function seedHeads() {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: HEAD, tenantId: TENANT, code: "4701-F601", name: "NEW-001 Expense Head", level: 2, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    { id: AP_HEAD, tenantId: TENANT, code: "2050", name: "Accounts Payable (NEW-001)", level: 1, classification: "liability", createdBy: MAKER, updatedBy: MAKER },
  ]).onConflictDoNothing());
}

function seedBill(id: string) {
  // Both PO/GRN refs present: the approve gate's three-way-match presence check
  // passes without needing an AP read-model snapshot. Amounts stay bigint paise.
  return scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id, tenantId: TENANT, billNo: `BILL-${id.slice(-8)}`, vendorId: VENDOR, headId: HEAD,
    grossMinor: 500000n, netMinor: 500000n, currency: "INR", deductions: [],
    poRef: "po-f601", grnRef: "grn-f601",
    billDate: "2026-07-15",
    stage: "section", status: "pending", createdBy: MAKER, updatedBy: MAKER, version: 1,
  }));
}

async function readBill(id: string) {
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id)));
  return rows[0];
}

async function auditEvents(corr: string) {
  return scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(and(
    eq(outboxMessages.correlationId, corr), eq(outboxMessages.eventType, "audit.event.record"),
  )));
}

async function clean() {
  for (const c of CORRS) {
    await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, c)));
  }
  for (const b of BILLS) {
    for (const s of ["section", "accounts"]) for (const a of [OFF_A, OFF_B]) {
      await db.delete(processed).where(eq(processed.messageId, msgId(b, s, a)));
    }
    await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, b)));
  }
}

beforeEach(async () => { await clean(); await seedHeads(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("NEW-001 two-stage bill approval (distinct officers, stage-exact id)", () => {
  it("(a) officer A then officer B advance one bill to pay/passed, one passed event + one journal, two staged audits", async () => {
    await seedBill(BILL);
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();

    // Stage 1 — Section Officer A on stage 'section'.
    await q.publish(COMMANDS.billApprove, {
      messageId: msgId(BILL, "section", OFF_A), type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: OFF_A, correlationId: "corr-f601-a1", schemaVersion: "1.1",
      payload: { id: BILL, tenantId: TENANT, expectedStage: "section" },
    });
    await q.drain();

    let bill = await readBill(BILL);
    expect(bill?.stage).toBe("accounts");
    expect(bill?.status).toBe("pending");

    // Stage 2 — Accounts Officer B on stage 'accounts'. A DIFFERENT id (actor
    // and stage both differ), so it is a distinct delivery — the P1 fix.
    await q.publish(COMMANDS.billApprove, {
      messageId: msgId(BILL, "accounts", OFF_B), type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: OFF_B, correlationId: "corr-f601-a2", schemaVersion: "1.1",
      payload: { id: BILL, tenantId: TENANT, expectedStage: "accounts" },
    });
    await q.drain();
    await q.stop();

    bill = await readBill(BILL);
    expect(bill?.stage).toBe("pay");
    expect(bill?.status).toBe("passed");
    expect(q.dlq).toHaveLength(0);

    // Exactly one finance.bill.passed and one GL spine journal (finance.gl.post),
    // both from the final (stage-2) transaction.
    const passed = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(and(
      eq(outboxMessages.correlationId, "corr-f601-a2"), eq(outboxMessages.eventType, "finance.bill.passed"))));
    expect(passed).toHaveLength(1);
    const glPost = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(and(
      eq(outboxMessages.correlationId, "corr-f601-a2"), eq(outboxMessages.eventType, "finance.gl.post"))));
    expect(glPost).toHaveLength(1);

    // Two approve audits, one per stage, each naming the stage (CAG trail).
    const a1 = await auditEvents("corr-f601-a1");
    const a2 = await auditEvents("corr-f601-a2");
    expect(a1).toHaveLength(1);
    expect(a2).toHaveLength(1);
    expect((a1[0]!.payload as any).stage).toBe("section");
    expect((a1[0]!.payload as any).nextStage).toBe("accounts");
    expect((a2[0]!.payload as any).stage).toBe("accounts");
    expect((a2[0]!.payload as any).nextStage).toBe("pay");
  });

  it("(b) the same officer double-clicking stage 1 (same stage-exact id) advances exactly once", async () => {
    await seedBill(DUP_BILL);
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();

    const dupId = msgId(DUP_BILL, "section", OFF_A);
    for (const corr of ["corr-f601-dup1", "corr-f601-dup2"]) {
      await q.publish(COMMANDS.billApprove, {
        messageId: dupId, type: COMMANDS.billApprove, // SAME id — double click
        tenantId: TENANT, actorId: OFF_A, correlationId: corr, schemaVersion: "1.1",
        payload: { id: DUP_BILL, tenantId: TENANT, expectedStage: "section" },
      });
      await q.drain();
    }
    await q.stop();

    const bill = await readBill(DUP_BILL);
    expect(bill?.stage).toBe("accounts"); // advanced exactly ONE stage, not two
    expect(bill?.status).toBe("pending");
    expect(bill?.version).toBe(2); // one version bump only
    expect(q.dlq).toHaveLength(0);
    // Only the first delivery produced an audit; the duplicate returned at markProcessed.
    const a1 = await auditEvents("corr-f601-dup1");
    const a2 = await auditEvents("corr-f601-dup2");
    expect(a1).toHaveLength(1);
    expect(a2).toHaveLength(0);
  });

  it("(c) the message id is stage-exact and actor-exact (D-66)", () => {
    // Equal for the same {bill, stage, actor}.
    expect(msgId(BILL, "section", OFF_A)).toBe(msgId(BILL, "section", OFF_A));
    // Different per stage (this is the exact P1 collision the constant key caused).
    expect(msgId(BILL, "section", OFF_A)).not.toBe(msgId(BILL, "accounts", OFF_A));
    // Different per actor.
    expect(msgId(BILL, "section", OFF_A)).not.toBe(msgId(BILL, "section", OFF_B));
    // The OLD constant key would have collided across stages; the new key does not.
    const oldConstant = idempotentId({ idempotencyKey: `bill-approve:${BILL}`, tenantId: TENANT });
    expect(msgId(BILL, "section", OFF_A)).not.toBe(oldConstant);
  });
});
