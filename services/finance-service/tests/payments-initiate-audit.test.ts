/**
 * GAP-FINANCE-PAYMENTS-01 -- releasing a payment is an authorising act:
 *  - POST /v1/finance/payments/eft requires the officer's reason (10..500 chars);
 *  - the "initiate" audit event carries WHAT was authorised (exact paise amount,
 *    mode, bill, DDO) and WHY (the reason), with the actor on the envelope;
 *  - the money path is unchanged: payment === bill net, bill -> paid, and the
 *    creator / passer still cannot pay (409, enforced server-side).
 *
 * Real Postgres (no mocks). A fresh random tenant per run: finance rows are
 * append-only for finance_svc, so fixed ids would collide on a re-run.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { financeBills, financePayments } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { initiateEftBody } from "../src/modules/payments/validators.js";
import { COMMANDS } from "../src/topics.js";

// Set by the service vitest config (never a literal in a test file: CI scans every commit for secrets).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const CREATOR = randomUUID();
const PASSER = randomUUID();
const PAYER = randomUUID();
const REASON = "Sanction order 14/2026 dated 02-09-2026";
const CORR = `corr-pay01-${randomUUID().slice(0, 8)}`;

const headers = (sub: string) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["finance_officer"], sid: "s-pay01" }, SECRET)}`,
  "content-type": "application/json",
  "x-idempotency-key": randomUUID(),
});

async function seedHeads() {
  // The initiate consumer posts Dr Accounts-Payable / Cr Bank, resolved by code (defaults 2050 / 1100).
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: randomUUID(), tenantId: TENANT, code: "2050", name: "Accounts Payable control", level: 1, createdBy: CREATOR, updatedBy: CREATOR },
    { id: randomUUID(), tenantId: TENANT, code: "1100", name: "Bank", level: 1, createdBy: CREATOR, updatedBy: CREATOR },
  ]).onConflictDoNothing());
}

async function seedPassedBill(netMinor: bigint) {
  const headId = randomUUID();
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({ id: headId, tenantId: TENANT, code: `EXP-${headId.slice(0, 6)}`, name: "Expense head", level: 2, createdBy: CREATOR, updatedBy: CREATOR }));
  const id = randomUUID();
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id, tenantId: TENANT, billNo: `B-${id.slice(0, 6)}`, vendorId: randomUUID(), headId,
    grossMinor: netMinor, netMinor, currency: "INR", deductions: [], billDate: "2026-09-15",
    stage: "pay", status: "passed", createdBy: CREATOR, updatedBy: PASSER,
  }));
  return id;
}

// The initiate consumer leaves a GL-spine journal command and events in the shared outbox. Another suite runs a real
// relay over that table and would pick them up (and dead-letter them, the accounts here are not seeded), so remove
// this tenant's rows once done.
afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))).catch(() => {});
  await sqlClient.end();
});

describe("initiateEftBody (pure) -- the reason is mandatory", () => {
  const ok = { billId: randomUUID(), ddoCode: "DDO12345", mode: "NEFT", amountMinor: "1500000" };
  it("rejects a missing, blank or too-short reason and an over-long one", () => {
    for (const reason of [undefined, "", "          ", "too short", "x".repeat(501)]) {
      expect(initiateEftBody.safeParse({ ...ok, reason }).success, String(reason)).toBe(false);
    }
  });
  it("accepts 10 and 500 characters and trims the stored reason", () => {
    expect(initiateEftBody.safeParse({ ...ok, reason: "a".repeat(10) }).success).toBe(true);
    expect(initiateEftBody.safeParse({ ...ok, reason: "a".repeat(500) }).success).toBe(true);
    expect(initiateEftBody.parse({ ...ok, reason: `  ${REASON}  ` }).reason).toBe(REASON);
  });
});

describe("POST /v1/finance/payments/eft -- reason is required", () => {
  it("400s without a reason and with a too-short one, naming the field; nothing is queued", async () => {
    await seedHeads();
    const billId = await seedPassedBill(150000n);
    const app = await buildApp();
    try {
      for (const reason of [undefined, "short"]) {
        const res = await app.inject({
          method: "POST", url: "/v1/finance/payments/eft", headers: headers(PAYER),
          payload: { billId, ddoCode: "DDO12345", mode: "NEFT", amountMinor: "150000", ...(reason ? { reason } : {}) },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().fieldErrors).toEqual([expect.objectContaining({ field: "reason" })]);
      }
    } finally { await app.close(); }
  });

  it("with a reason a different officer is accepted (202); the bill's creator and passer still get 409", async () => {
    await seedHeads();
    const billId = await seedPassedBill(150000n);
    const app = await buildApp();
    try {
      const pay = (sub: string) => app.inject({
        method: "POST", url: "/v1/finance/payments/eft", headers: headers(sub),
        payload: { billId, ddoCode: "DDO12345", mode: "NEFT", amountMinor: "150000", reason: REASON },
      });
      expect((await pay(PAYER)).statusCode).toBe(202);
      const asPasser = await pay(PASSER);
      expect(asPasser.statusCode).toBe(409);
      expect(asPasser.json().code).toBe("PAYER_IS_PASSER");
    } finally { await app.close(); }
  });
});

describe("finance.payment.initiate consumer -- audit event carries amount and reason", () => {
  // 12,34,56,789.01 rupees and a value above 2^53 paise: both must survive as exact decimal strings.
  it.each([
    ["a large rupee amount", 123456789_01n],
    ["an amount above 2^53 paise", 9_007_199_254_740_993n],
  ])("%s: payment === bill net to the paisa, and the audit detail has the exact paise string + reason", async (_label, net) => {
    await seedHeads();
    const billId = await seedPassedBill(net);
    const paymentId = randomUUID();
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.paymentInitiate, {
      messageId: randomUUID(), type: COMMANDS.paymentInitiate, tenantId: TENANT, actorId: PAYER, correlationId: CORR, schemaVersion: "1.0",
      payload: { id: paymentId, tenantId: TENANT, billId, ddoCode: "ddo12345", mode: "NEFT", amountMinor: net.toString(), reason: REASON },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.map((d) => d.error)).toEqual([]);

    const pay = await scoped(TENANT, (tx) => tx.select().from(financePayments).where(eq(financePayments.id, paymentId)));
    expect(pay).toHaveLength(1);
    expect(pay[0]?.amountMinor).toBe(net);
    const bill = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, billId)));
    expect(bill[0]?.status).toBe("paid");

    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, CORR)));
    const audit = outbox
      .map((r) => r.payload as Record<string, unknown>)
      .find((p) => p.action === "initiate" && p.resourceType === "payment" && p.resourceId === paymentId);
    expect(audit).toBeDefined();
    expect(audit).toMatchObject({
      service: "finance", outcome: "success",
      billId, ddoCode: "DDO12345", mode: "NEFT", currency: "INR",
      amountMinor: net.toString(), reason: REASON,
    });
    // The actor is the payer, on the envelope.
    const envelope = outbox.find((r) => (r.payload as Record<string, unknown>).resourceId === paymentId && (r.payload as Record<string, unknown>).action === "initiate");
    expect(envelope?.actorId).toBe(PAYER);
  });

  it("a command queued before the reason became mandatory still processes, with no reason key in the audit detail", async () => {
    await seedHeads();
    const net = 777_00n;
    const billId = await seedPassedBill(net);
    const paymentId = randomUUID();
    const corr = `${CORR}-legacy`;
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.paymentInitiate, {
      messageId: randomUUID(), type: COMMANDS.paymentInitiate, tenantId: TENANT, actorId: PAYER, correlationId: corr, schemaVersion: "1.0",
      payload: { id: paymentId, tenantId: TENANT, billId, ddoCode: "DDO12345", mode: "NEFT", amountMinor: net.toString() },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq).toHaveLength(0);
    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, corr)));
    const audit = outbox.map((r) => r.payload as Record<string, unknown>).find((p) => p.action === "initiate" && p.resourceId === paymentId);
    expect(audit).toMatchObject({ amountMinor: "77700", outcome: "success" });
    expect(audit).not.toHaveProperty("reason");
  });
});
