/**
 * NEW-001 (FF-06, D-66) — XS-1 cross-service: the two-stage approval produces
 * EXACTLY ONE GL journal, with BOTH the payments consumer and the GL consumer
 * registered on one queue against one real Postgres (real outbox relay, no
 * mocks). Replaying the stage-2 approval produces NO second journal
 * (deterministic journal id from `bill:<id>`).
 *
 * This is the end-to-end proof the register's DoD asks for: a bill passes both
 * stages with two different officers and posts exactly one journal.
 *
 * Mirrors municipal-challan-integration.test.ts's real-DB, relay-to-completion
 * pattern (registerGlConsumers + relayOnce loop).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { idempotentId } from "@civitasone/auth";
import { relayOnce } from "@civitasone/outbox";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1111-4000-8000-00000000f605";
const MAKER  = "00000000-aaaa-4000-8000-00000000f605";
const OFF_A  = "00000000-bbbb-4000-8000-00000000f605";
const OFF_B  = "00000000-cccc-4000-8000-00000000f605";
const VENDOR = "f6050000-aaaa-4000-8000-000000000001";
const HEAD   = "f6050000-bbbb-4000-8000-000000000001"; // expense head (bill.headId)
const AP_HEAD = "f6050000-cccc-4000-8000-000000000001"; // AP control (code 2050)
const NET    = 750000n;

// A fresh bill id per run -> a fresh DETERMINISTIC journal id (deterministicId
// is bill:<id>). This matters because finance_svc (the non-superuser service
// role, correctly) has no DELETE on gl.finance_journals, so a journal row
// posted by a prior run persists; a unique id per run keeps each run's
// single-journal assertions isolated without granting the test extra privilege.
let BILL = "";

function msgId(stage: string, actor: string): string {
  return idempotentId({ idempotencyKey: `bill-approve:${BILL}:${stage}:${actor}`, tenantId: TENANT });
}

function tenantWrappedQueue(): MemoryQueue {
  // Mirror worker.ts: every handler runs under the message's tenant GUC so
  // FORCE RLS reads/writes succeed, exactly like production.
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  (q as any).subscribe = (topic: string, handler: (m: any) => Promise<void>) =>
    rawSubscribe(topic, (m: any) => runWithTenant(m.tenantId, () => handler(m)));
  return q;
}

async function relayToCompletion(q: MemoryQueue, max = 500): Promise<void> {
  for (let i = 0; i < max; i++) {
    const relayed = await relayOnce(db as never, q, 200, "finance-service");
    if (relayed === 0) return;
  }
  throw new Error("relayToCompletion: outbox did not drain");
}

async function seedHeads() {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: HEAD, tenantId: TENANT, code: "4705-F605", name: "NEW-001 XS Expense Head", level: 2, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    { id: AP_HEAD, tenantId: TENANT, code: "2050", name: "Accounts Payable (NEW-001 XS)", level: 1, classification: "liability", createdBy: MAKER, updatedBy: MAKER },
  ]).onConflictDoNothing());
}

function seedBill() {
  return scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: BILL, tenantId: TENANT, billNo: `BILL-${BILL.slice(-8)}`, vendorId: VENDOR, headId: HEAD,
    grossMinor: NET, netMinor: NET, currency: "INR", deductions: [],
    poRef: "po-f605", grnRef: "grn-f605", billDate: "2026-07-20",
    stage: "section", status: "pending", createdBy: MAKER, updatedBy: MAKER, version: 1,
  }));
}

async function journalRow() {
  const id = deterministicId(`bill:${BILL}`);
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, id)));
  return rows[0];
}

async function clean() {
  // finance_svc (non-superuser) has no DELETE on gl.finance_journals and this
  // test must not grant it any — a unique BILL id per run keeps the journal
  // assertions isolated instead (see the BILL comment above). Clean only the
  // tables this role owns.
  for (const c of ["corr-f605-a1", "corr-f605-a2", "corr-f605-replay"]) {
    await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, c)));
  }
  for (const s of ["section", "accounts"]) for (const a of [OFF_A, OFF_B]) {
    await db.delete(processed).where(eq(processed.messageId, msgId(s, a)));
  }
  if (BILL) await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, BILL)));
}

beforeEach(async () => { BILL = randomUUID(); await seedHeads(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("NEW-001 XS-1 — two-stage approval posts exactly one GL journal (both consumers, real relay)", () => {
  it("two approvals by distinct officers post one balanced journal; replay of stage 2 posts no second journal", async () => {
    await seedBill();
    const q = tenantWrappedQueue();
    registerPaymentsConsumers(q);
    registerGlConsumers(q);
    await q.start();

    // Stage 1 (section, officer A).
    await q.publish(COMMANDS.billApprove, {
      messageId: msgId("section", OFF_A), type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: OFF_A, correlationId: "corr-f605-a1", schemaVersion: "1.1",
      payload: { id: BILL, tenantId: TENANT, expectedStage: "section" },
    });
    await q.drain();
    await relayToCompletion(q);
    await q.drain();

    // No journal yet — the GL spine journal is only enqueued on the FINAL stage.
    expect(await journalRow()).toBeFalsy();

    // Stage 2 (accounts, officer B) — bill reaches pay/passed and enqueues the journal.
    const stage2 = {
      messageId: msgId("accounts", OFF_B), type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: OFF_B, correlationId: "corr-f605-a2", schemaVersion: "1.1",
      payload: { id: BILL, tenantId: TENANT, expectedStage: "accounts" },
    };
    await q.publish(COMMANDS.billApprove, stage2);
    await q.drain();
    await relayToCompletion(q);
    await q.drain();

    const bill = (await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, BILL))))[0];
    expect(bill?.stage).toBe("pay");
    expect(bill?.status).toBe("passed");

    const journal = await journalRow();
    expect(journal, "exactly one GL journal must have been posted by the second hop").toBeTruthy();
    expect(journal!.lines).toHaveLength(2);
    const debit = journal!.lines.find((l: { debitMinor: string }) => l.debitMinor !== "0");
    const credit = journal!.lines.find((l: { creditMinor: string }) => l.creditMinor !== "0");
    expect(debit!.debitMinor).toBe(NET.toString());   // Dr expense head
    expect(debit!.accountCode).toBe(HEAD);
    expect(credit!.creditMinor).toBe(NET.toString());  // Cr AP control
    expect(credit!.accountCode).toBe(AP_HEAD);
    expect(q.dlq).toHaveLength(0);

    // ── Replay of the stage-2 approval: deterministic journal id -> no second journal ──
    // Remove the inbox marker to simulate a redelivery after an inbox purge
    // older than the retention window (design section 2.6 / 6.2).
    await db.delete(processed).where(eq(processed.messageId, msgId("accounts", OFF_B)));
    await q.publish(COMMANDS.billApprove, { ...stage2, correlationId: "corr-f605-replay" });
    await q.drain();
    await relayToCompletion(q);
    await q.drain();
    await q.stop();

    // The guarded update finds the bill already at 'pay' (status no longer
    // 'pending' at stage 'accounts'), so the stage-2 approve is refused — the
    // bill does not advance and NO second journal is enqueued. Even if a journal
    // were re-enqueued, the deterministic id makes the GL consumer a no-op.
    const journals = await scoped(TENANT, (tx) => tx.select().from(financeJournals)
      .where(eq(financeJournals.id, deterministicId(`bill:${BILL}`))));
    expect(journals).toHaveLength(1); // still exactly one
    const billAfter = (await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, BILL))))[0];
    expect(billAfter?.stage).toBe("pay");
    expect(billAfter?.status).toBe("passed");
  });
});
