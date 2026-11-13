/**
 * finance_payments.bank_account_id references the bank-account master (payments.finance_bank_accounts),
 * the table POST /v1/finance/bank-accounts writes -- not treasury.finance_banks, which nothing populates
 * (migration 0165). A payment that names an account of the office must therefore succeed; one that names an
 * unknown, other-tenant or inactive account is refused up front (422 BANK_ACCOUNT_NOT_FOUND) and, if it still
 * reaches the consumer, fails ONCE as a NonRetryableError instead of an FK violation retried to exhaustion.
 *
 * Real Postgres (no mocks). A fresh random tenant per run: finance rows are append-only for finance_svc.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import * as paymentsRepo from "../src/modules/payments/repo.js";
import { financeBills, financePayments, financeBankAccounts } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

// Set by the service vitest config (never a literal in a test file: CI scans every commit for secrets).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const CREATOR = randomUUID();
const PASSER = randomUUID();
const PAYER = randomUUID();
const REASON = "Sanction order 14/2026 dated 02-09-2026";
const CORR = `corr-bankfk-${randomUUID().slice(0, 8)}`;

const headers = (sub: string) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["finance_officer"], sid: "s-bankfk" }, SECRET)}`,
  "content-type": "application/json",
  "x-idempotency-key": randomUUID(),
});

async function seedHeads() {
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

async function seedAccount(tenantId: string, status = "active") {
  const id = randomUUID();
  await scoped(tenantId, (tx) => tx.insert(financeBankAccounts).values({
    id, tenantId, bankName: "State Bank of India", accountNo: "30012345678", ifsc: "SBIN0001234", status, createdBy: CREATOR,
  }));
  return id;
}

async function runConsumer(billId: string, paymentId: string, bankAccountId: string | undefined, corr: string, maxAttempts = 1) {
  const q = new MemoryQueue({ maxAttempts });
  registerPaymentsConsumers(q);
  await q.start();
  await q.publish(COMMANDS.paymentInitiate, {
    messageId: randomUUID(), type: COMMANDS.paymentInitiate, tenantId: TENANT, actorId: PAYER, correlationId: corr, schemaVersion: "1.0",
    payload: { id: paymentId, tenantId: TENANT, billId, ddoCode: "DDO12345", mode: "NEFT", amountMinor: "150000", reason: REASON, ...(bankAccountId ? { bankAccountId } : {}) },
  });
  await q.drain();
  await q.stop();
  return q;
}

afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))).catch(() => {});
  await sqlClient.end();
});

describe("migration 0165 -- the FK targets the bank-account master", () => {
  it("fk_fpayments_bank is gone and fk_fpayments_bank_account references payments.finance_bank_accounts", async () => {
    const rows = await sqlClient`
      SELECT c.conname, c.convalidated, t.relname AS ref_table, n.nspname AS ref_schema
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.confrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.conrelid = 'payments.finance_payments'::regclass AND c.contype = 'f' AND c.conname LIKE 'fk_fpayments_bank%'`;
    expect(rows.map((r) => r.conname)).toEqual(["fk_fpayments_bank_account"]);
    expect(rows[0]).toMatchObject({ ref_schema: "payments", ref_table: "finance_bank_accounts", convalidated: true });
  });

  it("a payment row may carry NULL or a master account id, but not an id nothing backs", async () => {
    await seedHeads();
    const account = await seedAccount(TENANT);
    const insert = async (billId: string, bankAccountId: string | null) => scoped(TENANT, (tx) => tx.insert(financePayments).values({
      id: randomUUID(), tenantId: TENANT, billId, mode: "NEFT", amountMinor: 1n, ddoCode: "DDO12345",
      ...(bankAccountId ? { bankAccountId } : {}), status: "initiated", createdBy: CREATOR, updatedBy: CREATOR,
    }));
    await expect(insert(await seedPassedBill(1n), null)).resolves.toBeDefined();
    await expect(insert(await seedPassedBill(1n), account)).resolves.toBeDefined();
    await expect(insert(await seedPassedBill(1n), randomUUID())).rejects.toMatchObject({ code: "23503" });
  });
});

describe("POST /v1/finance/payments/eft -- bankAccountId is validated up front", () => {
  it("unknown, other-tenant and inactive accounts get 422 BANK_ACCOUNT_NOT_FOUND; an active own account and no account get 202", async () => {
    await seedHeads();
    const own = await seedAccount(TENANT);
    const inactive = await seedAccount(TENANT, "inactive");
    const foreign = await seedAccount(OTHER_TENANT);
    const app = await buildApp();
    try {
      const pay = async (bankAccountId?: string) => {
        const billId = await seedPassedBill(150000n);
        return app.inject({
          method: "POST", url: "/v1/finance/payments/eft", headers: headers(PAYER),
          payload: { billId, ddoCode: "DDO12345", mode: "NEFT", amountMinor: "150000", reason: REASON, ...(bankAccountId ? { bankAccountId } : {}) },
        });
      };
      for (const bad of [randomUUID(), foreign, inactive]) {
        const res = await pay(bad);
        expect(res.statusCode, bad).toBe(422);
        expect(res.json().code).toBe("BANK_ACCOUNT_NOT_FOUND");
      }
      expect((await pay(own)).statusCode).toBe(202);
      expect((await pay()).statusCode).toBe(202);
    } finally { await app.close(); }
  });
});

describe("finance.payment.initiate consumer -- bank account", () => {
  it("a valid account: the payment row carries it and finance.payment.made is emitted", async () => {
    await seedHeads();
    const account = await seedAccount(TENANT);
    const billId = await seedPassedBill(150000n);
    const paymentId = randomUUID();
    const corr = `${CORR}-ok`;
    const q = await runConsumer(billId, paymentId, account, corr);
    expect(q.dlq.map((d) => d.error)).toEqual([]);
    const pay = await scoped(TENANT, (tx) => tx.select().from(financePayments).where(eq(financePayments.id, paymentId)));
    expect(pay).toHaveLength(1);
    expect(pay[0]?.bankAccountId).toBe(account);
    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, corr)));
    expect(outbox.filter((r) => r.topic === EVENTS.paymentMade)).toHaveLength(1);
  });

  it("no account: unchanged -- the payment is created with bank_account_id NULL", async () => {
    await seedHeads();
    const billId = await seedPassedBill(150000n);
    const paymentId = randomUUID();
    const q = await runConsumer(billId, paymentId, undefined, `${CORR}-none`);
    expect(q.dlq).toHaveLength(0);
    const pay = await scoped(TENANT, (tx) => tx.select().from(financePayments).where(eq(financePayments.id, paymentId)));
    expect(pay[0]?.bankAccountId).toBeNull();
  });

  it.each(["unknown", "other-tenant"])("%s account: NonRetryable -- one attempt, dead-lettered with BANK_ACCOUNT_NOT_FOUND, nothing written", async (kind) => {
    await seedHeads();
    const bad = kind === "unknown" ? randomUUID() : await seedAccount(OTHER_TENANT);
    const billId = await seedPassedBill(150000n);
    const paymentId = randomUUID();
    const corr = `${CORR}-${kind}`;
    const spy = vi.spyOn(paymentsRepo, "isActiveBankAccountTx");
    try {
      const q = await runConsumer(billId, paymentId, bad, corr, 3);
      expect(spy).toHaveBeenCalledTimes(1); // maxAttempts is 3: a retryable error would have called it 3 times
      expect(q.dlq).toHaveLength(1);
      expect(q.dlq[0]?.error).toMatch(/^BANK_ACCOUNT_NOT_FOUND/);
    } finally { spy.mockRestore(); }
    expect(await scoped(TENANT, (tx) => tx.select().from(financePayments).where(eq(financePayments.id, paymentId)))).toHaveLength(0);
    const bill = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, billId)));
    expect(bill[0]?.status).toBe("passed");
    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, corr)));
    expect(outbox.filter((r) => r.topic === EVENTS.paymentMade)).toHaveLength(0);
  });
});
