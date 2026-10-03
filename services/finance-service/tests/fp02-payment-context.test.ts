/**
 * GAP-FINANCE-PAYMENTS-DETAIL-04 (fp-finance-02): the payment status history and the decision
 * context (beneficiary, bill, approver) behind GET /v1/finance/payments/:id/context.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeVendors } from "../src/modules/masters/schema.js";
import { financeBills, financePayments, financePaymentEvents } from "../src/modules/payments/schema.js";
import * as repo from "../src/modules/payments/repo.js";
import { bearer } from "./_fp02.js";

const T = "aaaaaaaa-0f02-4000-8000-000000000031";
const OTHER = "aaaaaaaa-0f02-4000-8000-000000000032";
const PAYER = "00000000-0f02-4000-8000-0000000000f1";
const APPROVER = "00000000-0f02-4000-8000-0000000000f2";
const HEAD = "0f020000-0000-4000-8000-000000000031";
const VENDOR = "0f020000-0000-4000-8000-000000000032";
const BILL = "0f020000-0000-4000-8000-000000000033";
const PAYMENT = "0f020000-0000-4000-8000-000000000034";

let app: Awaited<ReturnType<typeof buildApp>>;
const fin = (tenant = T) => bearer(tenant, PAYER, ["finance_officer"]);

async function cleanup() {
  await scoped(T, (tx) => tx.delete(financePaymentEvents).where(eq(financePaymentEvents.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financePayments).where(eq(financePayments.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financeBills).where(eq(financeBills.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financeVendors).where(eq(financeVendors.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, T)));
}
beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  await scoped(T, (tx) => tx.insert(financeHeads).values({ id: HEAD, tenantId: T, code: "5100-FP02", name: "FP02 head", level: 2, createdBy: PAYER, updatedBy: PAYER }));
  await scoped(T, (tx) => tx.insert(financeVendors).values({
    id: VENDOR, tenantId: T, name: "M/s Beneficiary Traders", category: "supplies", pan: "FPAAA1111A", address: "1 Road",
    bankName: "SBI", bankAccountNo: "000111222333", ifsc: "SBIN0001234", createdBy: PAYER, updatedBy: PAYER,
  }));
  await scoped(T, (tx) => tx.insert(financeBills).values({
    id: BILL, tenantId: T, billNo: "BILL/FP02/001", vendorId: VENDOR, headId: HEAD, grossMinor: 100000n, netMinor: 100000n, deductions: [], status: "paid", createdBy: PAYER, updatedBy: PAYER,
  }));
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("payment status history", () => {
  it("every status write appends an event in the same transaction, with its actor", async () => {
    await scoped(T, async (tx) => {
      await repo.insertPayment(tx, { id: PAYMENT, tenantId: T, billId: BILL, mode: "NEFT", amountMinor: 100000n, status: "initiated", createdBy: PAYER, updatedBy: PAYER });
    });
    await scoped(T, async (tx) => {
      expect(await repo.updatePaymentUnlessStatusIn(tx, PAYMENT, T, ["released", "cancelled"], { status: "pending_approval", updatedBy: PAYER })).toBe(1);
    });
    // a blocked update writes neither a status change nor an event
    await scoped(T, async (tx) => {
      expect(await repo.updatePaymentUnlessStatusIn(tx, PAYMENT, T, ["pending_approval"], { status: "pending_approval", updatedBy: PAYER })).toBe(0);
    });
    await scoped(T, async (tx) => { await repo.updatePayment(tx, PAYMENT, { status: "released", updatedBy: APPROVER }); });
    const events = await scoped(T, (tx) => tx.select().from(financePaymentEvents).where(eq(financePaymentEvents.paymentId, PAYMENT)).orderBy(financePaymentEvents.createdAt));
    expect(events.map((e) => e.status)).toEqual(["initiated", "pending_approval", "released"]);
    expect(events.map((e) => e.actorId)).toEqual([PAYER, PAYER, APPROVER]);
  });
});

describe("GET /v1/finance/payments/:id/context", () => {
  it("returns beneficiary, bill, approver and the timeline", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/finance/payments/${PAYMENT}/context`, headers: fin() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.beneficiary).toEqual({ vendorId: VENDOR, name: "M/s Beneficiary Traders" });
    expect(body.bill).toEqual({ id: BILL, billNo: "BILL/FP02/001" });
    expect(body.approvedBy).toBe(APPROVER);
    expect(body.events.map((e: { status: string }) => e.status)).toEqual(["initiated", "pending_approval", "released"]);
  });

  it("is tenant-scoped (404 for another tenant) and finance-role-gated", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/finance/payments/${PAYMENT}/context`, headers: fin(OTHER) })).statusCode).toBe(404);
    const denied = await app.inject({ method: "GET", url: `/v1/finance/payments/${PAYMENT}/context`, headers: bearer(T, PAYER, ["procurement_officer"]) });
    expect(denied.statusCode).toBe(403);
  });
});
