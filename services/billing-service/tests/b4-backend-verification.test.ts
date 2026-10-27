/**
 * UAT B4 backend verification items for billing (docs/gap-ledger/billing.md "Backend verification
 * items"). Each describe is the "Test to add" of one ledger row, run against real Postgres
 * (FORCE RLS) and real Fastify:
 *  - HOME-01: a plain tenant user ("viewer") gets 403 on invoice, IRN and GSTN endpoints.
 *  - PAYMENTS-02: GET /v1/billing/payments rows carry id + invoiceId + amountMinor + method and
 *    NO name-like field (so the web's bespoke payment mapper, not the generic one, is right).
 *  - PLANS-DETAIL-01: GET /v1/billing/plans/:id returns the same field names the create form posts.
 * INVOICES-06 (cap + status + offset) and INVOICES-DETAIL-01 (role, reason, 202) are pinned by
 * invoices-list-paging.test.ts and einvoice-irn-authz.test.ts; the 24h window and idempotency by
 * closure3-s4-01/02 and the consumer lifecycle tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";
import { billingPayments } from "../src/modules/payments/schema.js";
import { registerPlansConsumers } from "../src/modules/plans/consumer.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = randomUUID();
const ACTOR = randomUUID();
const INV = randomUUID();
const PAY = randomUUID();
const bearer = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "s-b4" }, SECRET, 3600)}` });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(fn: (tx: Tx) => Promise<R>) => runWithTenant(T, () => db.transaction(fn)) as Promise<R>;
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();
let app: Awaited<ReturnType<typeof buildApp>>;
const planCode = `b4-${randomUUID().slice(0, 8)}`;
let planId = "";

beforeAll(async () => {
  registerPlansConsumers(queue);
  await queue.start();
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(billingInvoices).values({ id: INV, tenantId: T, periodMonth: "2026-09", status: "issued", totalMinor: 5000n, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(billingPayments).values({ id: PAY, tenantId: T, invoiceId: INV, amountMinor: 5000n, method: "bank_transfer", status: "completed", receiptNo: "RCPT-1", createdBy: ACTOR, updatedBy: ACTOR });
  });
});
afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(billingPayments).where(eq(billingPayments.tenantId, T));
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, T));
  });
  await withTenantScope(db as never, "00000000-0000-0000-0000-000000000000", (tx: any) => tx.execute(sql`DELETE FROM plans.billing_plans WHERE code = ${planCode}`));
  await app.close();
  await sqlClient.end();
});

describe("GAP-BILLING-HOME-01: server-side role gate on invoice, IRN and GSTN endpoints", () => {
  const viewer = () => bearer(["viewer"]);
  it("GET /v1/billing/invoices is 403 for a plain tenant user and 200 for billing_admin", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/billing/invoices", headers: viewer() })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/billing/invoices", headers: bearer(["billing_admin"]) })).statusCode).toBe(200);
  });
  it("POST generate-irn and cancel-irn are 403 for a plain tenant user", async () => {
    expect((await app.inject({ method: "POST", url: `/v1/billing/invoices/${INV}/generate-irn`, headers: viewer(), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/billing/invoices/${INV}/cancel-irn`, headers: viewer(), payload: { reason: "x" } })).statusCode).toBe(403);
  });
  it("every GSTN endpoint (status, file a return, return status, verify GSTIN) is 403 for a plain tenant user", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/billing/gstn/status", headers: viewer() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/billing/gstn/returns", headers: viewer(), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/billing/gstn/returns/${randomUUID()}/status`, headers: viewer() })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/billing/gstn/gstin/07AAACN1234A1Z5/verify", headers: viewer() })).statusCode).toBe(403);
  });
});

describe("GAP-BILLING-PAYMENTS-02: payments list payload shape", () => {
  it("each row carries id, invoiceId, amountMinor (string), method and status, and no name-like field", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/billing/payments", headers: bearer(["billing_admin"]) });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<Record<string, unknown>>;
    const row = rows.find((x) => x.id === PAY)!;
    expect(row).toMatchObject({ id: PAY, invoiceId: INV, amountMinor: "5000", method: "bank_transfer", status: "completed", receiptNo: "RCPT-1" });
    for (const k of ["name", "title", "subject", "label", "code", "contractNo", "fileNo"]) expect(row).not.toHaveProperty(k);
  });
  it("a plain tenant user is refused", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/billing/payments", headers: bearer(["viewer"]) })).statusCode).toBe(403);
  });
});

describe("GAP-BILLING-PLANS-DETAIL-01: GET /plans/:id uses the field names the create form posts", () => {
  it("a created plan reads back priceMinor, code, govtExempt, currency, name and active", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/billing/plans", headers: bearer(["super_admin"]), payload: { name: "B4 Standard", code: planCode, priceMinor: 49900, currency: "INR", govtExempt: true } });
    expect(created.statusCode).toBe(202);
    planId = created.json().id;
    await drain();
    const got = await app.inject({ method: "GET", url: `/v1/billing/plans/${planId}`, headers: bearer(["tenant_admin"]) });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ id: planId, name: "B4 Standard", code: planCode, priceMinor: "49900", currency: "INR", govtExempt: true, active: true });
  });
});
