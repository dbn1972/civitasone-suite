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
import { billingPayments } from "../src/modules/payments/schema.js";
import { registerInvoicesConsumers } from "../src/modules/invoices/consumer.js";
import { renderInvoicePdf, type InvoicePdfModel } from "../src/modules/invoices/pdf.js";
import { assertGstIssuable, invoiceSupplierGstinFromEnv, validateGstSplit, splitIntraStateTax } from "../src/modules/invoices/domain.js";

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
    await tx.delete(billingPayments).where(eq(billingPayments.tenantId, T));
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
    // the settlement now also writes a payments row; remove it (see the note in the /pay describe below)
    await asTenant((tx) => tx.delete(billingPayments).where(eq(billingPayments.invoiceId, id)));
  });
});

describe("legacy PATCH /pay: payable-state guard and payments row", () => {
  const pay = (id: string) => app.inject({ method: "PATCH", url: `/v1/billing/invoices/${id}/pay`, headers: tok });
  // Reads the invoice's payment rows and removes them at once: billing_payments is shared across test files and
  // uat-g3-billing.test.ts re-creates its status CHECK, which fails while any 'completed' row exists.
  const payments = async (id: string) => asTenant(async (tx) => {
    const rows = await tx.select().from(billingPayments).where(eq(billingPayments.invoiceId, id));
    await tx.delete(billingPayments).where(eq(billingPayments.invoiceId, id));
    return rows;
  });
  const paidEvents = async (id: string) => (await asTenant((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.topic, "billing.invoice.paid")))))
    .filter((m) => (m.payload as { invoiceId: string }).invoiceId === id);
  const issued = async (period: string) => {
    const id = await create(period, [{ description: "Training day", amountMinor: 50000 }]);
    expect((await issue(id)).statusCode).toBe(202);
    await drain();
    return id;
  };

  it("a draft bill cannot be paid: 409 INVOICE_NOT_PAYABLE, nothing changes", async () => {
    const id = await create("2027-06", [{ description: "Training day", amountMinor: 50000 }]);
    const r = await pay(id);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVOICE_NOT_PAYABLE");
    await drain();
    expect((await row(id)).status).toBe("draft");
    expect(await payments(id)).toHaveLength(0);
    expect(await paidEvents(id)).toHaveLength(0);
  });

  it("a cancelled bill cannot be paid", async () => {
    const id = await issued("2027-07");
    expect((await app.inject({ method: "PATCH", url: `/v1/billing/invoices/${id}/cancel`, headers: tok, payload: { reason: "raised in error" } })).statusCode).toBe(202);
    await drain();
    expect((await row(id)).status).toBe("cancelled");
    expect((await pay(id)).statusCode).toBe(409);
    expect((await row(id)).status).toBe("cancelled");
  });

  it("paying twice: the second is 409, one payments row, one invoice.paid event, paid_at not moved", async () => {
    const id = await issued("2027-08");
    expect((await pay(id)).statusCode).toBe(202);
    await drain();
    const paidAt = (await row(id)).paidAt;
    const again = await pay(id);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("INVOICE_NOT_PAYABLE");
    await drain();
    expect((await row(id)).paidAt).toEqual(paidAt);
    const ps = await payments(id);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.amountMinor).toBe(50000n);
    expect(ps[0]!.method).toBe("legacy_settlement");
    expect(ps[0]!.status).toBe("completed");
    expect(await paidEvents(id)).toHaveLength(1);
  });

  it("a partly paid bill settles only the balance", async () => {
    const id = await issued("2027-09");
    await asTenant((tx) => tx.update(billingInvoices).set({ status: "partially_paid", paidMinor: 20000n }).where(eq(billingInvoices.id, id)));
    expect((await pay(id)).statusCode).toBe(202);
    await drain();
    expect((await row(id)).status).toBe("paid");
    expect((await payments(id)).map((p) => p.amountMinor)).toEqual([30000n]);
  });
});

describe("review fixes: concurrent settlement, state rule, odd paise, nil-tax bill of supply, non-retryable", () => {
  const takePayments = async (id: string) => asTenant(async (tx) => {
    const rows = await tx.select().from(billingPayments).where(eq(billingPayments.invoiceId, id));
    await tx.delete(billingPayments).where(eq(billingPayments.invoiceId, id));
    return rows;
  });
  const paidEventsFor = async (id: string) => (await asTenant((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.topic, "billing.invoice.paid")))))
    .filter((m) => (m.payload as { invoiceId: string }).invoiceId === id);
  const issuedBill = async (period: string, amountMinor = 50000) => {
    const id = await create(period, [{ description: "Training day", amountMinor }]);
    expect((await issue(id)).statusCode).toBe(202);
    await drain();
    return id;
  };
  const pay = (id: string) => app.inject({ method: "PATCH", url: `/v1/billing/invoices/${id}/pay`, headers: tok });
  const receipt = (id: string, amountMinor: number) => app.inject({
    method: "POST", url: "/v1/billing/payments", headers: tok,
    payload: { tenantId: T, invoiceId: id, amountMinor, method: "neft", gateway: "offline" },
  });

  it("two pays in parallel: exactly one payments row, one invoice.paid, paid_minor = total (repeated on 8 bills)", async () => {
    for (let i = 0; i < 8; i++) {
      const id = await issuedBill(`2028-${String(i + 1).padStart(2, "0")}`);
      const [a, b] = await Promise.all([pay(id), pay(id)]);
      expect([a.statusCode, b.statusCode].every((c) => c === 202 || c === 409)).toBe(true);
      await drain();
      const r = await row(id);
      expect(r.status).toBe("paid");
      expect(r.paidMinor).toBe(50000n);
      const ps = await takePayments(id);
      expect(ps).toHaveLength(1);
      expect(ps[0]!.amountMinor).toBe(50000n);
      expect(await paidEventsFor(id)).toHaveLength(1);
    }
  });

  it("a pay racing a partial receipt never overpays or overwrites it: the rows always add up to paid_minor <= total", async () => {
    for (let i = 0; i < 8; i++) {
      const id = await issuedBill(`2029-${String(i + 1).padStart(2, "0")}`);
      await Promise.all([pay(id), receipt(id, 30000)]);
      await drain();
      const r = await row(id);
      const ps = await takePayments(id);
      const sum = ps.reduce((a, p) => a + p.amountMinor, 0n);
      expect(r.paidMinor).toBe(sum);
      expect(r.paidMinor <= 50000n).toBe(true);
      expect(ps.length).toBeGreaterThanOrEqual(1);
      expect(ps.length).toBeLessThanOrEqual(2);
      expect((await paidEventsFor(id)).length).toBe(r.status === "paid" ? 1 : 0);
    }
  });

  it("a pay after a partial receipt settles the CURRENT balance, not the total on top of it", async () => {
    const id = await issuedBill("2030-01");
    const msg = { messageId: randomUUID(), type: "billing.invoice.pay", tenantId: T, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id } };
    // another writer lands a partial receipt first; the pay command (which would settle 50,000) must not overwrite it
    await asTenant((tx) => tx.update(billingInvoices).set({ status: "partially_paid", paidMinor: 20000n }).where(eq(billingInvoices.id, id)));
    await (queue as unknown as { publish(t: string, m: unknown): Promise<void> }).publish("billing.invoice.pay", msg);
    await drain();
    const r = await row(id);
    expect(r.paidMinor).toBe(50000n); // settled the CURRENT balance (30,000), not a stale 50,000 on top of 20,000
    expect((await takePayments(id)).map((p) => p.amountMinor)).toEqual([30000n]);
    expect(await paidEventsFor(id)).toHaveLength(1);
  });

  it("a DomainError in a consumer is dead-lettered at once, not retried", async () => {
    const { MemoryQueue } = await import("@civitasone/queue");
    const q = new MemoryQueue({ maxAttempts: 3 });
    registerInvoicesConsumers(q);
    await q.start();
    const id = await create("2031-01", [{ description: "Training day", amountMinor: 50000 }]); // a draft: not payable
    await q.publish("billing.invoice.pay", { messageId: randomUUID(), type: "billing.invoice.pay", tenantId: T, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id } });
    await q.drain();
    await q.stop();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/^INVOICE_NOT_PAYABLE:/); // the NonRetryable wrapper's message; a retried raw error would not carry the code prefix
  });

  it("issue enforces the intra-/inter-state head rule, not just the sum (422 GST_SPLIT_INVALID)", async () => {
    // supplier Haryana (06), place of supply Delhi (07) = inter-state, but the bill was split CGST/SGST. The create schema
    // already applies validateGstSplit, so build the bad row directly to exercise the issue-time check.
    const bad = randomUUID();
    await asTenant((tx) => tx.insert(billingInvoices).values({
      id: bad, tenantId: T, periodMonth: "2031-03", status: "draft", totalMinor: 236000n, taxMinor: 36000n, supplierGstin: HARYANA_GSTIN,
      recipientGstin: "07AABCD5678B1Z2", placeOfSupply: "07", cgstMinor: 18000n, sgstMinor: 18000n, igstMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const r = await issue(bad);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("GST_SPLIT_INVALID");
    expect(r.json().message).toMatch(/inter-state/);
  });
});

describe("odd-paise tax and nil-tax bill of supply (pure)", () => {
  const base = { supplierGstin: HARYANA_GSTIN, recipientGstin: RECIPIENT, placeOfSupply: "06", igstMinor: 0n };
  it("an odd intra-state tax splits CGST rounded down, SGST rounded up; anything else is refused with the exact figures", () => {
    expect(splitIntraStateTax(1801n)).toEqual({ cgstMinor: 900n, sgstMinor: 901n });
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 901n }, 1801n)).toBeNull();
    const msg = validateGstSplit({ ...base, cgstMinor: 901n, sgstMinor: 900n }, 1801n);
    expect(msg).toMatch(/odd and cannot be split equally: use CGST 900 and SGST 901/);
    expect(validateGstSplit({ ...base, cgstMinor: 900n, sgstMinor: 900n }, 1800n)).toBeNull();
    expect(validateGstSplit({ ...base, cgstMinor: 1000n, sgstMinor: 800n }, 1800n)).toMatch(/must be equal \(900 paise each/);
  });

  it("a registered supplier's nil-tax bill prints as BILL OF SUPPLY with the supplier GSTIN, no tax heads, no reverse-charge line", async () => {
    const m: InvoicePdfModel = {
      invoiceNumber: "INV-2627-000020", periodMonth: "2027-01", status: "issued", issuedAt: "2026-11-09T00:00:00.000Z",
      supplierGstin: HARYANA_GSTIN, recipientGstin: null, placeOfSupply: null,
      taxMinor: "0", cgstMinor: "0", sgstMinor: "0", igstMinor: "0", totalMinor: "50000", paidMinor: "0", outstandingMinor: "50000",
      items: [{ description: "Training day", kind: "line", quantity: "1", amountMinor: "50000", hsnSac: null }],
    };
    const flat = await pdfFlatText(await renderInvoicePdf(m, { supplier: SUPPLIER }, AT));
    expect(flat).toContain("BILL OF SUPPLY");
    expect(flat).not.toContain("TAX INVOICE");
    expect(flat).toContain(`Supplier GSTIN ${HARYANA_GSTIN}`);
    expect(flat).not.toContain("CGST");
    expect(flat).not.toContain("reverse charge");
    expect(flat).toContain("Total 500.00");
  });
});
