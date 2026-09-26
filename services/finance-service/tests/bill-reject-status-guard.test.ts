/**
 * Bill reject status guard (H2).
 *
 * Gap: PATCH /v1/finance/bills/:id/reject (routes.ts) and its consumer
 * (billReject in payments/consumer.ts) checked maker != checker but never
 * the bill's current status. A bill already 'passed' (GL posted, see
 * billApprove's enqueueSpineJournal) or 'paid' (cash disbursed — a payment
 * row and cash-book entry exist, see paymentInitiate) could still be
 * rejected: status flips to 'rejected' while its real GL postings and
 * payment records are left untouched — a genuine audit/compliance
 * inconsistency, not an ordinary reject.
 *
 * This proves:
 *  - the CONSUMER'S OWN guard (assertBillRejectable, domain.ts) is
 *    authoritative: rejecting a 'passed' or 'paid' bill is a permanent
 *    business rejection (NonRetryableError -> DLQ immediately, status
 *    BILL_NOT_REJECTABLE), and the bill's status column is left unchanged.
 *  - the ROUTE'S synchronous pre-check (mirrors budget/distribution-routes
 *    .ts's toDomain(err, 409) pattern) gives the HTTP caller an immediate
 *    409 for the same cases, instead of a silent 202 the consumer only
 *    rejects later with nothing observable at the HTTP boundary (this
 *    module's mutations are all fire-and-forget 202s — see routes.ts).
 *  - a bill still in a legitimate pre-payment status ('pending') is
 *    unaffected: reject still succeeds end to end, at both layers.
 *
 * Bills are seeded directly at the target status (mirrors
 * three-way-match-gate.test.ts's seedBill / dom-024's seeded-'pending_
 * approval'-draft pattern) rather than driven through the full create ->
 * approve x2 -> [pay] flow: billReject touches no budget/GL/period-close
 * state, so the full flow's dependencies (allocation, heads, period-open,
 * DDO code, payment mode) are irrelevant to this guard and would only add
 * unrelated failure modes to this file.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// "b02" tags these as the bug-2 (H2) fixture set — plain hex, unlike "h2"
// (not a hex digit; withTenantScope correctly rejects a non-UUID tenantId).
const TENANT  = "aaaaaaaa-1111-4000-8000-000000000b02";
const MAKER   = "00000000-aaaa-4000-8000-000000000b02";
const CHECKER = "00000000-bbbb-4000-8000-000000000b02";
const VENDOR  = "66666666-aaaa-4000-8000-000000000001";
const HEAD    = "66666666-bbbb-4000-8000-000000000001";

function makeToken(roles: string[] = ["finance_admin"]) {
  return signToken({ sub: CHECKER, tid: TENANT, roles, sid: "sess-b02" }, SECRET);
}

// Consumer-level scenario bills (published straight to a MemoryQueue).
const BILL_PASSED_C  = "66666666-cccc-4000-8000-0000000000c1"; // blocked
const BILL_PAID_C    = "66666666-cccc-4000-8000-0000000000c2"; // blocked
const BILL_PENDING_C = "66666666-cccc-4000-8000-0000000000c3"; // happy path
const MSG_PASSED_C  = "66666666-dddd-4000-8000-0000000000c1";
const MSG_PAID_C    = "66666666-dddd-4000-8000-0000000000c2";
const MSG_PENDING_C = "66666666-dddd-4000-8000-0000000000c3";

// HTTP-level scenario bills (PATCH .../reject via the real route).
const BILL_PASSED_H  = "66666666-cccc-4000-8000-000000000e01"; // blocked -> 409
const BILL_PAID_H    = "66666666-cccc-4000-8000-000000000e02"; // blocked -> 409
const BILL_PENDING_H = "66666666-cccc-4000-8000-000000000e03"; // happy path -> 202

const ALL_BILL_IDS = [
  BILL_PASSED_C, BILL_PAID_C, BILL_PENDING_C,
  BILL_PASSED_H, BILL_PAID_H, BILL_PENDING_H,
];
const ALL_MSG_IDS = [MSG_PASSED_C, MSG_PAID_C, MSG_PENDING_C];

async function seedHead() {
  // fk_fbills_head (migrations/0055_add_foreign_keys.sql) requires a parent
  // finance_heads row before finance_bills can reference it.
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "4700-H2", name: "Bill Reject Guard Head", level: 2, createdBy: MAKER, updatedBy: MAKER,
  }).onConflictDoNothing());
}

function seedBill(id: string, status: string, stage: string) {
  return scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id, tenantId: TENANT, billNo: `BILL-${id.slice(-8)}`, vendorId: VENDOR, headId: HEAD,
    grossMinor: 500000n, netMinor: 500000n, currency: "INR", deductions: [],
    stage, status, createdBy: MAKER, updatedBy: MAKER,
  }));
}

async function readBill(id: string) {
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id)));
  return rows[0];
}

async function clean() {
  for (const c of ["corr-h2-passed-c", "corr-h2-paid-c", "corr-h2-pending-c"]) {
    await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, c)));
  }
  for (const m of ALL_MSG_IDS) {
    await db.delete(processed).where(eq(processed.messageId, m));
  }
  for (const id of ALL_BILL_IDS) {
    await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, id)));
  }
}

beforeEach(async () => { await clean(); await seedHead(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("H2 — billReject consumer guard (assertBillRejectable, authoritative)", () => {
  it("blocks reject of a 'passed' bill: DLQ's BILL_NOT_REJECTABLE, status unchanged", async () => {
    await seedBill(BILL_PASSED_C, "passed", "pay");
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.billReject, {
      messageId: MSG_PASSED_C, type: COMMANDS.billReject,
      tenantId: TENANT, actorId: CHECKER, correlationId: "corr-h2-passed-c", schemaVersion: "1.0",
      payload: { id: BILL_PASSED_C, tenantId: TENANT, reason: "attempted reject after passed" },
    });
    await q.drain();
    await q.stop();

    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/BILL_NOT_REJECTABLE/);

    const bill = await readBill(BILL_PASSED_C);
    expect(bill?.status).toBe("passed"); // unchanged — this is the compliance-inconsistency bug
  });

  it("blocks reject of a 'paid' bill: DLQ's BILL_NOT_REJECTABLE, status unchanged", async () => {
    // stage stays "pay" (the only terminal stage finance_bills_stage_check
    // allows post-migrations/0043 — 'section'|'accounts'|'pay') — status
    // alone advances passed -> paid at payment time (paymentInitiate never
    // touches `stage`, see consumer.ts).
    await seedBill(BILL_PAID_C, "paid", "pay");
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.billReject, {
      messageId: MSG_PAID_C, type: COMMANDS.billReject,
      tenantId: TENANT, actorId: CHECKER, correlationId: "corr-h2-paid-c", schemaVersion: "1.0",
      payload: { id: BILL_PAID_C, tenantId: TENANT, reason: "attempted reject after paid" },
    });
    await q.drain();
    await q.stop();

    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/BILL_NOT_REJECTABLE/);

    const bill = await readBill(BILL_PAID_C);
    expect(bill?.status).toBe("paid"); // unchanged — a real payment now exists against this bill
  });

  it("still allows reject of a 'pending' bill (happy path — guard doesn't break normal rejects)", async () => {
    await seedBill(BILL_PENDING_C, "pending", "section");
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.billReject, {
      messageId: MSG_PENDING_C, type: COMMANDS.billReject,
      tenantId: TENANT, actorId: CHECKER, correlationId: "corr-h2-pending-c", schemaVersion: "1.0",
      payload: { id: BILL_PENDING_C, tenantId: TENANT, reason: "genuinely rejecting a pending bill" },
    });
    await q.drain();
    await q.stop();

    expect(q.dlq.length).toBe(0);
    const bill = await readBill(BILL_PENDING_C);
    expect(bill?.status).toBe("rejected");

    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, "corr-h2-pending-c")));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});

describe("H2 — PATCH /v1/finance/bills/:id/reject route pre-check (synchronous 409)", () => {
  it("returns 409 for a 'passed' bill and never publishes (status stays 'passed')", async () => {
    await seedBill(BILL_PASSED_H, "passed", "pay");
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/finance/bills/${BILL_PASSED_H}/reject`,
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { reason: "attempted reject after passed" },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BILL_NOT_REJECTABLE");

    const bill = await readBill(BILL_PASSED_H);
    expect(bill?.status).toBe("passed");
  });

  it("returns 409 for a 'paid' bill and never publishes (status stays 'paid')", async () => {
    await seedBill(BILL_PAID_H, "paid", "pay"); // see the C-scenario comment above re: stage
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/finance/bills/${BILL_PAID_H}/reject`,
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { reason: "attempted reject after paid" },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BILL_NOT_REJECTABLE");

    const bill = await readBill(BILL_PAID_H);
    expect(bill?.status).toBe("paid");
  });

  it("still returns 202 for a 'pending' bill (happy path — route pre-check doesn't false-block)", async () => {
    await seedBill(BILL_PENDING_H, "pending", "section");
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/finance/bills/${BILL_PENDING_H}/reject`,
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { reason: "genuinely rejecting a pending bill" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});
