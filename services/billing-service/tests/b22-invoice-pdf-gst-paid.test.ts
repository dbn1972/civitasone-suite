/**
 * B22 (UAT 2026-11-09, numbers lane D2/D3/D4):
 *  - D2: the invoice PDF prints the invoice's STORED totals and amount x quantity per line (INV-2627-000001 printed
 *    Total 1,050.00, dropped the GST line and 2 x 1,000.00 against a stored 2,410.00).
 *  - D3: a bill that charges tax with no supplier GSTIN, or with a CGST/SGST/IGST split that does not add up, is
 *    refused at issue (422); BILLING_SUPPLIER_GSTIN supplies the GSTIN for a bill created without a gst block.
 *  - D4: the legacy full-settlement path emits billing.invoice.paid so finance posts the cash receipt.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { closePdfRenderer } from "@civitasone/render";
import { pdfFlatText } from "@civitasone/render/testing";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { billingInvoices, billingInvoiceItems } from "../src/modules/invoices/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerInvoicesConsumers } from "../src/modules/invoices/consumer.js";
import { renderInvoicePdf, type InvoicePdfModel } from "../src/modules/invoices/pdf.js";
import { assertGstIssuable, invoiceSupplierGstinFromEnv } from "../src/modules/invoices/domain.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "22220000-0000-4000-8000-0000000000a1";
const ACTOR = "22220000-0000-4000-8000-0000000000b1";
const tok = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles: ["super_admin"], sid: "s-b22" }, SECRET, 3600)}` };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(fn: (tx: Tx) => Promise<R>) => runWithTenant(T, () => db.transaction(fn)) as Promise<R>;
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();
const SUPPLIER = { name: "CivitasOne Platform Services", address: "Gurugram, Haryana", signatory: "R. Malhotra" };
const AT = new Date("2026-11-09T07:00:00.000Z");
const HARYANA_GSTIN = "06AAJCC7319K1ZE";
const RECIPIENT = "06AABCD5678B1Z2";

afterAll(async () => { await closePdfRenderer(); });

// The exact shape of INV-2627-000001 as stored: 2 x 1,000.00 line, 360.00 tax, 50.00 charge, total 2,410.00.
const inv1: InvoicePdfModel = {
  invoiceNumber: "INV-2627-000001", periodMonth: "2027-01", status: "paid", issuedAt: "2026-10-28T18:12:27.527Z",
  supplierGstin: null, recipientGstin: null, placeOfSupply: null,
  taxMinor: "36000", cgstMinor: "0", sgstMinor: "0", igstMinor: "0", totalMinor: "241000", paidMinor: "241000", outstandingMinor: "0",
  items: [
    { description: "Platform subscription - Q4 licence seats", kind: "line", quantity: "2", amountMinor: "100000", hsnSac: "998431" },
    { description: "GST", kind: "tax", quantity: "1", amountMinor: "36000", hsnSac: null },
    { description: "Onboarding fee", kind: "charge", quantity: "1", amountMinor: "5000", hsnSac: null },
  ],
};

describe("D2: the invoice PDF matches the stored record", () => {
  it("unregistered legacy row: stored total, line amount x quantity, tax shown as recorded, words for the stored total", async () => {
    const flat = await pdfFlatText(await renderInvoicePdf(inv1, { supplier: SUPPLIER }, AT));
    expect(flat).toContain("BILL OF SUPPLY");
    expect(flat).toContain("Total 2,410.00");
    expect(flat).toContain("Rupees Two Thousand Four Hundred Ten Only");
    expect(flat).toContain("998431 2 1,000.00 2,000.00");
    expect(flat).toContain("Value of supply 2,050.00");
    expect(flat).toContain("360.00");
    expect(flat).toContain("Paid 2,410.00");
    expect(flat).not.toContain("1,050.00");
    expect(flat).not.toContain("Fifty Only");
  });

  it("registered supplier: taxable value is amount x quantity, tax heads and stored total agree with the record", async () => {
    const m: InvoicePdfModel = {
      ...inv1, supplierGstin: HARYANA_GSTIN, recipientGstin: RECIPIENT, placeOfSupply: "06", status: "issued", paidMinor: "0", outstandingMinor: "241000",
      cgstMinor: "18000", sgstMinor: "18000",
    };
    const flat = await pdfFlatText(await renderInvoicePdf(m, { supplier: SUPPLIER }, AT));
    expect(flat).toContain("TAX INVOICE");
    expect(flat).toContain("Taxable value 2,050.00");
    expect(flat).toContain("CGST");
    expect(flat).toContain("180.00");
    expect(flat).toContain("Invoice total 2,410.00");
    expect(flat).toContain("Outstanding 2,410.00");
    expect(flat).toContain("Rupees Two Thousand Four Hundred Ten Only");
    expect(flat).not.toContain("1,050.00");
  });
});

describe("D3: assertGstIssuable (pure)", () => {
  const none = { cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n };
  it("an unregistered supplier cannot charge tax", () => {
    expect(() => assertGstIssuable({ supplierGstin: null, taxMinor: 36000n, ...none }, null)).toThrowError(/unregistered supplier cannot charge GST/);
    try { assertGstIssuable({ supplierGstin: null, taxMinor: 36000n, ...none }, null); } catch (e) { expect((e as { code: string }).code).toBe("TAX_WITHOUT_SUPPLIER_GSTIN"); }
  });
  it("a bill with no tax is a bill of supply (null) when unregistered, and uses the configured GSTIN when set", () => {
    expect(assertGstIssuable({ supplierGstin: null, taxMinor: 0n, ...none }, null)).toBeNull();
    expect(assertGstIssuable({ supplierGstin: null, taxMinor: 0n, ...none }, HARYANA_GSTIN)).toBe(HARYANA_GSTIN);
  });
  it("tax needs a split that adds up", () => {
    expect(() => assertGstIssuable({ supplierGstin: HARYANA_GSTIN, taxMinor: 36000n, ...none }, null)).toThrowError(/split/);
    expect(assertGstIssuable({ supplierGstin: HARYANA_GSTIN, taxMinor: 36000n, cgstMinor: 18000n, sgstMinor: 18000n, igstMinor: 0n }, null)).toBe(HARYANA_GSTIN);
    // configured GSTIN alone is not enough: the bill still needs its own split
    expect(() => assertGstIssuable({ supplierGstin: null, taxMinor: 36000n, ...none }, HARYANA_GSTIN)).toThrowError(/split/);
  });
  it("BILLING_SUPPLIER_GSTIN is read and validated", () => {
    const prev = process.env.BILLING_SUPPLIER_GSTIN;
    try {
      process.env.BILLING_SUPPLIER_GSTIN = ` ${HARYANA_GSTIN.toLowerCase()} `;
      expect(invoiceSupplierGstinFromEnv()).toBe(HARYANA_GSTIN);
      process.env.BILLING_SUPPLIER_GSTIN = "NOT-A-GSTIN";
      expect(invoiceSupplierGstinFromEnv()).toBeNull();
      delete process.env.BILLING_SUPPLIER_GSTIN;
      expect(invoiceSupplierGstinFromEnv()).toBeNull();
    } finally { if (prev === undefined) delete process.env.BILLING_SUPPLIER_GSTIN; else process.env.BILLING_SUPPLIER_GSTIN = prev; }
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
afterAll(async () => { delete process.env.BILLING_SUPPLIER_GSTIN; await wipe(); await app.close(); await sqlClient.end(); });

const taxItems = [
  { description: "Platform subscription", amountMinor: 100000, quantity: 2, kind: "line", hsnSac: "998431" },
  { description: "GST 18%", amountMinor: 36000, kind: "tax" },
];
async function create(periodMonth: string, items: unknown[], gst?: unknown): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: tok, payload: { tenantId: T, periodMonth, items, ...(gst ? { gst } : {}) } });
  expect(r.statusCode).toBe(202);
  await drain();
  return r.json().id as string;
}
const issue = (id: string) => app.inject({ method: "PATCH", url: `/v1/billing/invoices/${id}/issue`, headers: tok });
const row = async (id: string) => (await asTenant((tx) => tx.select().from(billingInvoices).where(eq(billingInvoices.id, id))))[0]!;

describe("D3: issue refuses tax without a supplier GSTIN / split", () => {
  it("a tax bill with no gst block is a 422 and stays a draft", async () => {
    const id = await create("2027-01", taxItems);
    const r = await issue(id);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TAX_WITHOUT_SUPPLIER_GSTIN");
    await drain();
    expect((await row(id)).status).toBe("draft");
  });

  it("a tax bill with a valid intra-state gst block issues under the supplier GSTIN series", async () => {
    const id = await create("2027-02", taxItems.map((i) => (i.kind === "tax" ? { ...i, amountMinor: 36000 } : i)),
      { supplierGstin: HARYANA_GSTIN, recipientGstin: RECIPIENT, placeOfSupply: "06", cgstMinor: 18000, sgstMinor: 18000, igstMinor: 0 });
    expect((await issue(id)).statusCode).toBe(202);
    await drain();
    const r = await row(id);
    expect(r.status).toBe("issued");
    expect(r.invoiceSeries).toBe(HARYANA_GSTIN);
  });

  it("a bill with no tax and no GSTIN still issues as a bill of supply (UNREGISTERED series)", async () => {
    const id = await create("2027-03", [{ description: "Training day", amountMinor: 50000 }]);
    expect((await issue(id)).statusCode).toBe(202);
    await drain();
    const r = await row(id);
    expect(r.status).toBe("issued");
    expect(r.invoiceSeries).toBe("UNREGISTERED");
    expect(r.supplierGstin).toBeNull();
  });

  it("with BILLING_SUPPLIER_GSTIN set a no-tax bill is issued under that GSTIN and carries it", async () => {
    process.env.BILLING_SUPPLIER_GSTIN = HARYANA_GSTIN;
    try {
      const id = await create("2027-04", [{ description: "Training day", amountMinor: 50000 }]);
      expect((await issue(id)).statusCode).toBe(202);
      await drain();
      const r = await row(id);
      expect(r.invoiceSeries).toBe(HARYANA_GSTIN);
      expect(r.supplierGstin).toBe(HARYANA_GSTIN);
    } finally { delete process.env.BILLING_SUPPLIER_GSTIN; }
  });
});

describe("D4: legacy full settlement emits billing.invoice.paid", () => {
  it("PATCH /pay on an issued bill enqueues one billing.invoice.paid with the total", async () => {
    const id = await create("2027-05", [{ description: "Training day", amountMinor: 50000 }]);
    expect((await issue(id)).statusCode).toBe(202);
    await drain();
    const r = await app.inject({ method: "PATCH", url: `/v1/billing/invoices/${id}/pay`, headers: tok });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await row(id)).status).toBe("paid");
    const ev = (await asTenant((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.topic, "billing.invoice.paid")))))
      .filter((m) => (m.payload as { invoiceId: string }).invoiceId === id);
    expect(ev).toHaveLength(1);
    expect((ev[0]!.payload as { totalMinor: string }).totalMinor).toBe("50000");
  });
});
