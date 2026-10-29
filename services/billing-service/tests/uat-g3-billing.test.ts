/**
 * UAT g3 regression tests (billing-service):
 *  #2  billing_payments_status_check must accept the 'completed' status the consumers write
 *  #7  a second invoice for an already-invoiced month is refused synchronously with 409
 *  #14 invoice / subscription updates bump `version`; cancelling a subscription stamps ends_at
 *  #17 an unset RAZORPAY_* env answers 503 PAYMENT_GATEWAY_NOT_CONFIGURED, not an unhandled 500
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";
import { billingSubscriptions } from "../src/modules/subscriptions/schema.js";
import * as invoiceRepo from "../src/modules/invoices/repo.js";
import * as subRepo from "../src/modules/subscriptions/repo.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e8a0000-0000-4000-8000-0000000007a1";
const A = "5e8aacc0-0000-4000-8000-0000000007a1";
const tok = (roles = ["platform_admin"]) => ({ authorization: `Bearer ${signToken({ sub: A, tid: T, roles, sid: "sess-g3" }, SECRET, 3600)}` });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(fn: (tx: Tx) => Promise<R>) => runWithTenant(T, () => db.transaction(fn)) as Promise<R>;
type AppT = Awaited<ReturnType<typeof buildApp>>;
let app: AppT;

async function wipe() {
  await asTenant(async (tx) => {
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, T));
    await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, T));
  });
}
beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("#2 migration 0026 converges billing_payments_status_check", () => {
  const migration = readFileSync(fileURLToPath(new URL("../migrations/0026_billing_payments_status_check.sql", import.meta.url)), "utf8");
  class Rollback extends Error {}

  it("repairs a drifted constraint (pending/received/failed/refunded only) so 'completed' is accepted", async () => {
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql.raw("ALTER TABLE payments.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_status_check"));
      await tx.execute(sql.raw("ALTER TABLE payments.billing_payments ADD CONSTRAINT billing_payments_status_check CHECK (status IN ('pending','received','failed','refunded'))"));
      await tx.execute(sql.raw(migration));
      const def = await tx.execute(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'billing_payments_status_check' AND conrelid = 'payments.billing_payments'::regclass`);
      const text = String((def as unknown as Array<{ def: string }>)[0]?.def);
      for (const s of ["pending", "completed", "received", "failed", "refunded"]) expect(text).toContain(`'${s}'`);
      // idempotent: running it again must not error
      await tx.execute(sql.raw(migration));
      throw new Rollback();
    })).rejects.toThrow(Rollback);
  });

  it("the shipped code writes 'completed' (guards against narrowing the constraint again)", () => {
    const consumer = readFileSync(fileURLToPath(new URL("../src/modules/payments/consumer.ts", import.meta.url)), "utf8");
    expect(consumer).toContain('status: "completed"');
    expect(migration).toContain("'completed'");
  });
});

describe("#7 duplicate invoice month is a synchronous 409", () => {
  it("POST /v1/billing/invoices and /generate return 409 for an already-invoiced month; another month is accepted", async () => {
    await asTenant((tx) => tx.insert(billingInvoices).values({
      id: randomUUID(), tenantId: T, periodMonth: "1998-03", status: "draft", totalMinor: 100n, createdBy: A, updatedBy: A,
    }));
    const body = (periodMonth: string) => ({ tenantId: T, periodMonth, items: [{ description: "UATTEST line", amountMinor: 1000 }] });
    const dup = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: tok(), payload: body("1998-03") });
    expect(dup.statusCode).toBe(409);
    expect(JSON.stringify(dup.json())).toContain("INVOICE_PERIOD_EXISTS");
    const dupGen = await app.inject({ method: "POST", url: "/v1/billing/invoices/generate", headers: tok(), payload: { tenantId: T, periodMonth: "1998-03" } });
    expect(dupGen.statusCode).toBe(409);
    const fresh = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: tok(), payload: body("1998-04") });
    expect(fresh.statusCode).toBe(202);
    expect((await asTenant(() => invoiceRepo.findByPeriod(T, "1998-03")))?.periodMonth).toBe("1998-03");
    expect(await asTenant(() => invoiceRepo.findByPeriod(T, "1997-01"))).toBeUndefined();
  });
});

describe("#14 version bump and subscription end stamp", () => {
  it("updateInvoice bumps version", async () => {
    const id = randomUUID();
    await asTenant((tx) => tx.insert(billingInvoices).values({ id, tenantId: T, periodMonth: "1996-01", status: "draft", totalMinor: 1n, createdBy: A, updatedBy: A }));
    await asTenant((tx) => invoiceRepo.updateInvoice(tx, id, { status: "issued" }));
    const row = (await asTenant((tx) => tx.select().from(billingInvoices).where(eq(billingInvoices.id, id))))[0]!;
    expect(row.status).toBe("issued");
    expect(row.version).toBe(2);
  });

  it("subscription updateStatus bumps version; cancel stamps ends_at once and keeps an existing end date", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const planId = randomUUID();
    const scheduled = new Date("2031-01-01T00:00:00Z");
    await asTenant(async (tx) => {
      await tx.insert(billingSubscriptions).values({ id: a, tenantId: T, planId, status: "active", createdBy: A, updatedBy: A });
      await tx.insert(billingSubscriptions).values({ id: b, tenantId: T, planId, status: "cancelled", endsAt: scheduled, createdBy: A, updatedBy: A });
      await subRepo.updateStatus(tx, a, "cancelled", A);
      await subRepo.updateStatus(tx, b, "cancelled", A);
    });
    const rows = await asTenant((tx) => tx.select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, T)));
    const ra = rows.find((r) => r.id === a)!;
    const rb = rows.find((r) => r.id === b)!;
    expect(ra.version).toBe(2);
    expect(ra.endsAt).not.toBeNull();
    expect(rb.endsAt?.toISOString()).toBe(scheduled.toISOString());
  });
});

describe("#17 unset Razorpay env is a 503, not a 500", () => {
  it("POST /v1/billing/payments/verify answers 503 PAYMENT_GATEWAY_NOT_CONFIGURED", async () => {
    const saved = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments/verify", headers: tok(["tenant_admin"]),
        payload: { razorpayOrderId: "order_x", razorpayPaymentId: "pay_x", razorpaySignature: "sig_x" },
      });
      expect(res.statusCode).toBe(503);
      expect(JSON.stringify(res.json())).toContain("PAYMENT_GATEWAY_NOT_CONFIGURED");
    } finally {
      if (saved !== undefined) process.env.RAZORPAY_KEY_SECRET = saved;
    }
  });
});
