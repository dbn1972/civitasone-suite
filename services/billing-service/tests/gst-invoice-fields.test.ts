/**
 * GAP-TENANT-ADMIN-PLANS-04 / owner decision #26: invoice fields supplier and
 * recipient GSTIN, HSN/SAC, CGST/SGST/IGST split, place of supply. Money is bigint
 * minor units on the wire as strings. Pure split rules + real-DB create/read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { billingInvoices, billingInvoiceItems } from "../src/modules/invoices/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerInvoicesConsumers } from "../src/modules/invoices/consumer.js";
import { validateGstSplit, invoiceNumber } from "../src/modules/invoices/domain.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "26260000-0000-4000-8000-0000000000a1";
const ACTOR = "26260000-0000-4000-8000-0000000000b1";
const auth = (roles: string[], tid = T) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-gst" }, SECRET, 3600)}` });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(fn: (tx: Tx) => Promise<R>) => runWithTenant(T, () => db.transaction(fn)) as Promise<R>;
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();

const SUP = "07AAACN1234A1Z5"; // Delhi supplier
const REC_SAME = "07AABCD5678B1Z2"; // Delhi recipient (intra-state)
const REC_OTHER = "27AABCD5678B1Z9"; // Maharashtra recipient (inter-state)

describe("validateGstSplit (pure)", () => {
  const base = { supplierGstin: SUP, recipientGstin: REC_SAME, placeOfSupply: "07" };
  it("intra-state: CGST == SGST, IGST 0, sum == tax", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1800n)).toBeNull();
  });
  it("intra-state with an IGST amount is refused", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 0n, sgstMinor: 0n, igstMinor: 1800n }, 1800n)).toMatch(/intra-state/i);
  });
  it("inter-state: IGST only, sum == tax", () => {
    const o = { supplierGstin: SUP, recipientGstin: REC_OTHER, placeOfSupply: "27" };
    expect(validateGstSplit({ ...o, cgstMinor: 0n, sgstMinor: 0n, igstMinor: 1800n }, 1800n)).toBeNull();
    expect(validateGstSplit({ ...o, cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1800n)).toMatch(/inter-state/i);
  });
  it("the split must add up to the tax lines exactly", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1801n)).toMatch(/tax/i);
  });
  it("CGST and SGST must be equal", () => {
    expect(validateGstSplit({ ...base, cgstMinor: 1000n, sgstMinor: 800n, igstMinor: 0n }, 1800n)).toMatch(/equal/i);
  });
  it("a malformed GSTIN is refused", () => {
    expect(validateGstSplit({ ...base, supplierGstin: "BAD", cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n }, 1800n)).toMatch(/GSTIN/);
  });
});

describe("invoiceNumber", () => {
  it("is deterministic from the period and id", () => {
    expect(invoiceNumber("2026-09", "abcdef12-0000-4000-8000-000000000000")).toBe("INV-202609-ABCDEF12");
  });
});

let app: Awaited<ReturnType<typeof buildApp>>;
async function wipe() {
  await asTenant(async (tx) => {
    await tx.delete(billingInvoiceItems).where(eq(billingInvoiceItems.tenantId, T));
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, T));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
  });
}
beforeAll(async () => { registerInvoicesConsumers(queue); await queue.start(); app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

const gstBody = {
  supplierGstin: SUP, recipientGstin: REC_SAME, placeOfSupply: "07",
  cgstMinor: 900, sgstMinor: 900, igstMinor: 0,
};
const items = [
  { description: "Platform subscription", amountMinor: 10000, kind: "line", hsnSac: "998431" },
  { description: "GST 18%", amountMinor: 1800, kind: "tax" },
];

describe("POST /v1/billing/invoices with GST fields", () => {
  it("persists the GST fields and exposes them as bigint-safe strings on the detail read", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: auth(["super_admin"]), payload: { tenantId: T, periodMonth: "2026-09", items, gst: gstBody } });
    expect(r.statusCode).toBe(202);
    await drain();
    const id = r.json().id as string;
    const d = await app.inject({ method: "GET", url: `/v1/billing/invoices/${id}`, headers: auth(["tenant_admin"]) });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({
      invoiceNumber: invoiceNumber("2026-09", id),
      supplierGstin: SUP, recipientGstin: REC_SAME, placeOfSupply: "07",
      cgstMinor: "900", sgstMinor: "900", igstMinor: "0", taxMinor: "1800",
    });
    expect(d.json().items[0]).toMatchObject({ hsnSac: "998431" });
    const list = await app.inject({ method: "GET", url: "/v1/billing/invoices", headers: auth(["tenant_admin"]) });
    expect(list.json().find((x: { id: string }) => x.id === id)).toMatchObject({ supplierGstin: SUP, cgstMinor: "900", invoiceNumber: invoiceNumber("2026-09", id) });
  });

  it("a split that does not add up to the tax lines is a 400 and creates nothing", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: auth(["super_admin"]), payload: { tenantId: T, periodMonth: "2026-10", items, gst: { ...gstBody, cgstMinor: 500 } } });
    expect(r.statusCode).toBe(400);
  });

  it("a malformed GSTIN or HSN/SAC is a 400", async () => {
    const bad1 = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: auth(["super_admin"]), payload: { tenantId: T, periodMonth: "2026-10", items, gst: { ...gstBody, recipientGstin: "123" } } });
    expect(bad1.statusCode).toBe(400);
    const bad2 = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: auth(["super_admin"]), payload: { tenantId: T, periodMonth: "2026-10", items: [{ ...items[0], hsnSac: "AB" }, items[1]], gst: gstBody } });
    expect(bad2.statusCode).toBe(400);
  });

  it("an invoice created without GST fields still works and reads null GST columns (legacy shape)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: auth(["super_admin"]), payload: { tenantId: T, periodMonth: "2026-11", items: [{ description: "Fee", amountMinor: 500 }] } });
    expect(r.statusCode).toBe(202);
    await drain();
    const d = await app.inject({ method: "GET", url: `/v1/billing/invoices/${r.json().id}`, headers: auth(["tenant_admin"]) });
    expect(d.json()).toMatchObject({ supplierGstin: null, recipientGstin: null, placeOfSupply: null, cgstMinor: "0", igstMinor: "0" });
  });
});
