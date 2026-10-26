/**
 * GAP-TENANT-ADMIN-SUBSCRIPTION-04 / owner decision #27: billing-service owns the
 * invoice list + PDF. GET /v1/billing/invoices/:id/pdf is tenant-scoped, role-gated,
 * and renders a real PDF carrying the GST tax-invoice fields from decision #26.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices, billingInvoiceItems } from "../src/modules/invoices/schema.js";
import { invoiceDocumentLines, formatMinor } from "../src/modules/invoices/pdf.js";
import { invoiceNumber } from "../src/modules/invoices/domain.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = "27270000-0000-4000-8000-0000000000a1";
const TB = "27270000-0000-4000-8000-0000000000b1";
const ACTOR = "27270000-0000-4000-8000-0000000000c1";
const INV = "27270000-0000-4000-8000-000000000001";
const DRAFT = "27270000-0000-4000-8000-000000000002";
const auth = (roles: string[], tid = TA) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-pdf" }, SECRET, 3600)}` });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(fn: (tx: Tx) => Promise<R>) => runWithTenant(TA, () => db.transaction(fn)) as Promise<R>;
let app: Awaited<ReturnType<typeof buildApp>>;

async function wipe() {
  await asTenant(async (tx) => {
    await tx.delete(billingInvoiceItems).where(eq(billingInvoiceItems.tenantId, TA));
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, TA));
  });
}
beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await asTenant(async (tx) => {
    await tx.insert(billingInvoices).values([
      {
        id: INV, tenantId: TA, periodMonth: "2026-09", status: "issued", totalMinor: 11800n, taxMinor: 1800n,
        supplierGstin: "07AAACN1234A1Z5", recipientGstin: "07AABCD5678B1Z2", placeOfSupply: "07",
        cgstMinor: 900n, sgstMinor: 900n, igstMinor: 0n, issuedAt: new Date("2026-09-05T00:00:00Z"),
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      { id: DRAFT, tenantId: TA, periodMonth: "2026-10", status: "draft", totalMinor: 500n, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(billingInvoiceItems).values([
      { tenantId: TA, invoiceId: INV, description: "Platform subscription", kind: "line", hsnSac: "998431", quantity: 1n, amountMinor: 10000n, createdBy: ACTOR, updatedBy: ACTOR },
      { tenantId: TA, invoiceId: INV, description: "GST 18%", kind: "tax", quantity: 1n, amountMinor: 1800n, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  });
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("formatMinor (bigint minor units, never float)", () => {
  it("formats paise exactly, including values above 2^53", () => {
    expect(formatMinor(11800n)).toBe("INR 118.00");
    expect(formatMinor(5n)).toBe("INR 0.05");
    expect(formatMinor(12345678901234567n)).toBe("INR 12,34,56,78,90,12,345.67"); // above 2^53, Indian grouping
  });
});

describe("invoiceDocumentLines", () => {
  it("carries supplier/recipient GSTIN, place of supply, HSN/SAC and the CGST/SGST/IGST split", () => {
    const lines = invoiceDocumentLines({
      invoiceNumber: "INV-202609-27270000", periodMonth: "2026-09", status: "issued", issuedAt: "2026-09-05T00:00:00.000Z",
      supplierGstin: "07AAACN1234A1Z5", recipientGstin: "07AABCD5678B1Z2", placeOfSupply: "07",
      taxMinor: "1800", cgstMinor: "900", sgstMinor: "900", igstMinor: "0", totalMinor: "11800", paidMinor: "0", outstandingMinor: "11800",
      items: [{ description: "Platform subscription", kind: "line", quantity: "1", amountMinor: "10000", hsnSac: "998431" }],
    }).join("\n");
    for (const needle of ["INV-202609-27270000", "07AAACN1234A1Z5", "07AABCD5678B1Z2", "Place of supply: 07", "998431", "CGST", "INR 9.00", "IGST", "INR 118.00"]) {
      expect(lines).toContain(needle);
    }
  });
});

describe("GET /v1/billing/invoices/:id/pdf", () => {
  it("returns a real, single-page PDF with a safe filename for a tenant admin", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/billing/invoices/${INV}/pdf`, headers: auth(["tenant_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(String(r.headers["content-disposition"])).toBe(`attachment; filename="${invoiceNumber("2026-09", INV)}.pdf"`);
    expect(r.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(r.rawPayload);
    expect(doc.getPageCount()).toBe(1);
  });

  it("billing_admin may download; a plain employee is refused (403)", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/billing/invoices/${INV}/pdf`, headers: auth(["billing_admin"]) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/billing/invoices/${INV}/pdf`, headers: auth(["employee"]) })).statusCode).toBe(403);
  });

  it("another tenant's invoice is a 404 (never reveals it exists)", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/billing/invoices/${INV}/pdf`, headers: auth(["tenant_admin"], TB) })).statusCode).toBe(404);
  });

  it("a draft has no tax invoice yet: 409 INVOICE_NOT_ISSUED", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/billing/invoices/${DRAFT}/pdf`, headers: auth(["tenant_admin"]) });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVOICE_NOT_ISSUED");
  });

  it("a malformed id is a 400", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/billing/invoices/not-a-uuid/pdf", headers: auth(["tenant_admin"]) })).statusCode).toBe(400);
  });
});
