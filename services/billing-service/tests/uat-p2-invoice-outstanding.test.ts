/**
 * UAT Phase 2 (A8, recon D21): a cancelled invoice is owed nothing. The register showed a cancelled
 * INV-202702-F0D46BF0 with Rs 500 outstanding because outstanding was total - paid for every status.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";

const rows: Array<Record<string, unknown>> = [];
vi.mock("../src/modules/invoices/repo.js", () => ({
  listByTenant: vi.fn(async () => rows),
}));

import { invoiceOutstandingMinor, outstandingMinor } from "../src/modules/invoices/domain.js";
import { listInvoices } from "../src/modules/invoices/queries.js";

const row = (status: string, totalMinor: bigint, paidMinor: bigint) => ({
  id: randomUUID(), tenantId: "t", invoiceNumber: null, supplierGstin: null, recipientGstin: null, placeOfSupply: null,
  cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, periodMonth: "2027-02", status, totalMinor, paidMinor, currency: "INR",
  issuedAt: null, paidAt: null, cancelledAt: status === "cancelled" ? new Date() : null,
});

describe("invoiceOutstandingMinor", () => {
  it("is zero for a cancelled bill, whatever was unpaid", () => {
    expect(invoiceOutstandingMinor("cancelled", 50000n, 0n)).toBe(0n);
    expect(invoiceOutstandingMinor("cancelled", 50000n, 20000n)).toBe(0n);
  });
  it("keeps total - paid (clamped) for every other status", () => {
    expect(invoiceOutstandingMinor("issued", 50000n, 20000n)).toBe(30000n);
    expect(invoiceOutstandingMinor("partially_paid", 50000n, 49999n)).toBe(1n);
    expect(invoiceOutstandingMinor("paid", 50000n, 50000n)).toBe(0n);
    expect(invoiceOutstandingMinor("draft", 50000n, 0n)).toBe(outstandingMinor(50000n, 0n));
  });
});

describe("GET /v1/billing/invoices list figures", () => {
  it("a cancelled invoice is listed with outstanding 0; an issued one keeps its balance", async () => {
    rows.length = 0;
    rows.push(row("cancelled", 50000n, 0n), row("issued", 250000n, 0n));
    const out = await listInvoices(`tenant-${randomUUID()}`);
    expect(out.map((r) => [r.status, r.outstandingMinor])).toEqual([["cancelled", "0"], ["issued", "250000"]]);
  });
});
