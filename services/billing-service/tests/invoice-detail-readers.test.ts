/** GAP-ADMIN-INVOICES-06: the invoice detail is readable by the same roles as the register; writes stay super-admin only. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices, billingInvoiceItems } from "../src/modules/invoices/schema.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = "5e7e0000-0000-4000-8000-0000000000a1";
const TB = "5e7e0000-0000-4000-8000-0000000000b1";
const ACTOR = "5e7eacc0-0000-4000-8000-0000000000a1";
const INV = "5e7e1000-0000-4000-8000-000000000001";
const auth = (roles: string[], tid = TA) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-inv" }, SECRET, 3600)}` });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(t: string, fn: (tx: Tx) => Promise<T>) => runWithTenant(t, () => db.transaction(fn)) as Promise<T>;
type AppT = Awaited<ReturnType<typeof buildApp>>;
let app: AppT;

async function wipe() {
  await asTenant(TA, async (tx) => {
    await tx.delete(billingInvoiceItems).where(eq(billingInvoiceItems.tenantId, TA));
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, TA));
  });
}
beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await asTenant(TA, async (tx) => {
    await tx.insert(billingInvoices).values({ id: INV, tenantId: TA, periodMonth: "2026-09", status: "issued", totalMinor: 250050n, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(billingInvoiceItems).values({ tenantId: TA, invoiceId: INV, description: "Platform fee", kind: "line", quantity: 1n, amountMinor: 250050n, createdBy: ACTOR, updatedBy: ACTOR });
  });
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GET /v1/billing/invoices/:id readers", () => {
  it.each([["billing_admin"], ["tenant_admin"], ["super_admin"], ["platform_admin"]])("%s can open the detail, with paise strings and line items", async (role) => {
    const res = await app.inject({ method: "GET", url: `/v1/billing/invoices/${INV}`, headers: auth([role]) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: INV, status: "issued", totalMinor: "250050", outstandingMinor: "250050", items: [{ description: "Platform fee", amountMinor: "250050" }] });
  });

  it("a plain employee is refused, and another tenant's invoice is a 404 for an admin", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/billing/invoices/${INV}`, headers: auth(["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/billing/invoices/${INV}`, headers: auth(["tenant_admin"], TB) })).statusCode).toBe(404);
  });

  it("opening the detail does not widen any write: mark-paid and cancel remain super-admin only", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/billing/invoices/${INV}/pay`, headers: auth(["billing_admin"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/billing/invoices/${INV}/cancel`, headers: auth(["tenant_admin"]), payload: { reason: "x y z" } })).statusCode).toBe(403);
  });
});
