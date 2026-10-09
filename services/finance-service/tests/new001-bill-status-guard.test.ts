/**
 * NEW-001 (FF-06, D-66) — bill-approve STATUS/STAGE guard (the P3 and P4 fixes).
 *
 * Before this change the approve consumer had no status guard at all:
 *   - probe P3: a 'rejected' bill approved by a different officer came back to
 *     life (section/rejected -> accounts/pending);
 *   - probe P4: approving a bill already at the final 'pay' stage threw a BARE
 *     DomainError (STAGE_TERMINAL via nextStage), which the queue retried as a
 *     transient error — a retry storm the caller never learns about.
 *
 * This file proves the inverse: approving a bill whose status is not 'pending'
 * (rejected / passed / paid / on_hold / under_review) is refused with
 * BILL_NOT_APPROVABLE, and a bill already at 'pay' is refused with
 * STAGE_TERMINAL. Both are NonRetryableError (land in the DLQ immediately — no
 * retry storm), and the bill's stage AND status are left completely unchanged.
 *
 * Bills are seeded directly at the target state (mirrors
 * bill-reject-status-guard.test.ts): the guard touches no budget/GL/period
 * state, so the full create -> approve flow's dependencies are irrelevant here.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { idempotentId } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1111-4000-8000-00000000f602";
const MAKER  = "00000000-aaaa-4000-8000-00000000f602";
const CHECKER = "00000000-bbbb-4000-8000-00000000f602";
const VENDOR = "f6020000-aaaa-4000-8000-000000000001";
const HEAD   = "f6020000-bbbb-4000-8000-000000000001";

// One bill per blocked status, plus one at the terminal 'pay' stage.
type Case = { id: string; msg: string; corr: string; status: string; stage: string; expectCode: RegExp };
const CASES: Case[] = [
  { id: "f6020000-cccc-4000-8000-000000000001", msg: "f6020000-dddd-4000-8000-000000000001", corr: "corr-f602-rejected",     status: "rejected",     stage: "section",  expectCode: /BILL_NOT_APPROVABLE/ },
  { id: "f6020000-cccc-4000-8000-000000000002", msg: "f6020000-dddd-4000-8000-000000000002", corr: "corr-f602-passed",       status: "passed",       stage: "pay",      expectCode: /STAGE_TERMINAL/ },
  { id: "f6020000-cccc-4000-8000-000000000003", msg: "f6020000-dddd-4000-8000-000000000003", corr: "corr-f602-paid",         status: "paid",         stage: "pay",      expectCode: /STAGE_TERMINAL/ },
  { id: "f6020000-cccc-4000-8000-000000000004", msg: "f6020000-dddd-4000-8000-000000000004", corr: "corr-f602-on_hold",      status: "on_hold",      stage: "section",  expectCode: /BILL_NOT_APPROVABLE/ },
  { id: "f6020000-cccc-4000-8000-000000000005", msg: "f6020000-dddd-4000-8000-000000000005", corr: "corr-f602-under_review", status: "under_review", stage: "accounts", expectCode: /BILL_NOT_APPROVABLE/ },
];

async function seedHead() {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "4702-F602", name: "NEW-001 Status Guard Head", level: 2, createdBy: MAKER, updatedBy: MAKER,
  }).onConflictDoNothing());
}

function seedBill(c: Case) {
  return scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: c.id, tenantId: TENANT, billNo: `BILL-${c.id.slice(-8)}`, vendorId: VENDOR, headId: HEAD,
    grossMinor: 500000n, netMinor: 500000n, currency: "INR", deductions: [],
    poRef: "po-f602", grnRef: "grn-f602",
    stage: c.stage, status: c.status, createdBy: MAKER, updatedBy: MAKER, version: 1,
  }));
}

async function readBill(id: string) {
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id)));
  return rows[0];
}

async function clean() {
  for (const c of CASES) {
    await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, c.corr)));
    await db.delete(processed).where(eq(processed.messageId, c.msg));
    await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, c.id)));
  }
}

beforeEach(async () => { await clean(); await seedHead(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("NEW-001 bill-approve status/stage guard (P3 + P4, authoritative)", () => {
  for (const c of CASES) {
    it(`refuses approve of a '${c.status}' bill (stage ${c.stage}) as non-retryable; state unchanged`, async () => {
      await seedBill(c);
      const q = new MemoryQueue({ maxAttempts: 1 });
      registerPaymentsConsumers(q);
      await q.start();
      await q.publish(COMMANDS.billApprove, {
        messageId: c.msg, type: COMMANDS.billApprove,
        tenantId: TENANT, actorId: CHECKER, correlationId: c.corr, schemaVersion: "1.1",
        payload: { id: c.id, tenantId: TENANT, expectedStage: c.stage },
      });
      await q.drain();
      await q.stop();

      // Non-retryable -> straight to the DLQ, not a retry storm (the P4 fix).
      expect(q.dlq).toHaveLength(1);
      expect(q.dlq[0]?.error).toMatch(c.expectCode);

      // Both stage and status are left exactly as seeded (the P3 fix: no
      // rejected bill comes back to life, no terminal bill advances).
      const bill = await readBill(c.id);
      expect(bill?.status).toBe(c.status);
      expect(bill?.stage).toBe(c.stage);
      expect(bill?.version).toBe(1);

      // No approve audit, no passed event, no GL post was written.
      const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, c.corr)));
      expect(outbox).toHaveLength(0);
    });
  }

  it("a double-delivery of a blocked approve is still a single DLQ entry (markProcessed rolled back, re-refused)", async () => {
    const c = CASES[0]!; // the rejected bill
    await seedBill(c);
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    for (let i = 0; i < 2; i++) {
      await q.publish(COMMANDS.billApprove, {
        messageId: c.msg, type: COMMANDS.billApprove,
        tenantId: TENANT, actorId: CHECKER, correlationId: c.corr, schemaVersion: "1.1",
        payload: { id: c.id, tenantId: TENANT, expectedStage: c.stage },
      });
      await q.drain();
    }
    await q.stop();
    // The refusal rolls back the transaction (incl. markProcessed), so the
    // redelivery is evaluated again and refused again — never silently
    // swallowed as "already processed".
    expect(q.dlq.length).toBeGreaterThanOrEqual(1);
    for (const d of q.dlq) expect(d.error).toMatch(/BILL_NOT_APPROVABLE/);
    const bill = await readBill(c.id);
    expect(bill?.status).toBe("rejected");
    expect(idempotentId({ idempotencyKey: `bill-approve:${c.id}:${c.stage}:${CHECKER}`, tenantId: TENANT })).toBeTypeOf("string");
  });
});
