import { describe, expect, it } from "vitest";
import {
  deviceRegisterResponseSchema, paymentSummarySchema, syncPushRequestSchema, TenderDetailSchema,
  BillSummarySchema, AdvanceSummarySchema, FinanceVendorDetailSchema,
} from "../src/index.js";

describe("@civitasone/schemas", () => {
  // Regression test for a CRITICAL cross-service contract bug: bidAmount used
  // to be required, but procurement-service's getTenderDetail (queries.ts)
  // deliberately omits it (sends `undefined`) for any bid whose financial
  // envelope hasn't been opened yet — the sealed-bid property the tender
  // module exists to enforce. Because the route validates its own response
  // with `TenderDetailSchema.parse(...)` before sending (sendValidated), that
  // made GET /v1/procurement/tenders/:id throw for any tender with an
  // unopened bid — i.e. essentially every real tender before financial-open.
  it("accepts a tender detail payload with a sealed (bidAmount-less) bid", () => {
    const parsed = TenderDetailSchema.safeParse({
      id: "t-1",
      tenderNo: "TND/2026/001",
      title: "Supply of office furniture",
      type: "open",
      estimatedValue: 500000,
      bidClosingDate: "2026-09-01",
      status: "evaluation",
      bidsReceived: 1,
      bids: [
        {
          bidId: "b-1",
          vendorId: "v-1",
          vendorName: "Acme Furnishings",
          technicalScore: 82,
          status: "technically_qualified",
          // bidAmount intentionally absent: financial envelope not yet opened.
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
  it("validates device register response", () => {
    const parsed = deviceRegisterResponseSchema.safeParse({
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      trustToken: "abc123",
      trustLevel: "recognized",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid payment summary", () => {
    const parsed = paymentSummarySchema.safeParse({
      referenceId: "x",
      beneficiary: "y",
      amountDisplay: "1",
      status: "bogus",
    });
    expect(parsed.success).toBe(false);
  });

  it("validates sync push request", () => {
    const parsed = syncPushRequestSchema.safeParse({
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      mailbox: "approvals",
      cursor: "0",
      mutations: [],
    });
    expect(parsed.success).toBe(true);
  });

  // Regression tests for a CRITICAL bug: payments/queries.ts returns money
  // fields as bigint-safe decimal STRINGS (H3: paise can exceed 2^53), but
  // these response schemas typed them as z.number() -- so sendValidated's
  // own schema.parse() 400'd GET /v1/finance/bills and would have 400'd
  // GET /v1/finance/advances the moment that table held real data.
  it("BillSummarySchema accepts the real bigint-safe string amount payments/queries.ts sends", () => {
    const parsed = BillSummarySchema.safeParse({
      id: "b-1", billNo: "BILL/2026/001", vendor: "Acme Supplies",
      amount: "473500000", submittedDate: "2026-08-01", status: "pending", threeWayMatch: "na",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.amount).toBe("473500000");
  });

  it("AdvanceSummarySchema accepts string amount/adjustedAmount/balance", () => {
    const parsed = AdvanceSummarySchema.safeParse({
      id: "a-1", advanceNo: "ADV/2026/001", beneficiary: "Suresh Nair", type: "employee",
      amount: "10000000", disbursedDate: "2026-08-01", adjustedAmount: "4000000", balance: "6000000",
      status: "active",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.amount).toBe("10000000");
      expect(parsed.data.balance).toBe("6000000");
    }
  });

  it("AdvanceSummarySchema still defaults adjustedAmount to a stringified 0 when omitted", () => {
    const parsed = AdvanceSummarySchema.safeParse({
      id: "a-2", advanceNo: "ADV/2026/002", beneficiary: "Kavita Sharma", type: "employee",
      amount: "5000000", disbursedDate: "2026-08-01", balance: "5000000", status: "active",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.adjustedAmount).toBe("0");
  });

  // Regression test for a CRITICAL bug: paymentSummarySchema had no `id`
  // field, so sendValidated's schema.parse() silently stripped the id the
  // query returns -- PaymentsTable.tsx's payment-detail link was dead even
  // though it already reads p.id to build the href.
  it("paymentSummarySchema preserves id through parse instead of stripping it", () => {
    const parsed = paymentSummarySchema.safeParse({
      id: "11111111-2222-4333-8444-555555555555",
      referenceId: "PAY-001", beneficiary: "Tech Supplies Ltd",
      amountDisplay: "10,000", status: "Queued",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.id).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("paymentSummarySchema still accepts a legacy/partial payload with no id", () => {
    const parsed = paymentSummarySchema.safeParse({
      referenceId: "PAY-002", beneficiary: "Bharat Construction", amountDisplay: "5,000", status: "Released",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.id).toBeUndefined();
  });

  // FinanceVendorDetailSchema.bills backs the vendor [id] page's Total
  // Bills/Total Paid/TDS Deducted rollup, previously permanently empty.
  it("FinanceVendorDetailSchema defaults bills to [] and accepts a real bill-history entry", () => {
    const base = {
      id: "v-1", name: "M/s Test Vendor", category: "supplies", status: "active",
      pan: "ABCDE1234F", gstin: null, address: "1 Test Road", contactPerson: null,
      email: null, phone: null, bankName: "Test Bank", ifsc: "TEST0001234",
      bankAccount: "000111222333", isActive: true, version: 1,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const withoutBills = FinanceVendorDetailSchema.safeParse(base);
    expect(withoutBills.success).toBe(true);
    if (withoutBills.success) expect(withoutBills.data.bills).toEqual([]);

    const withBills = FinanceVendorDetailSchema.safeParse({
      ...base,
      bills: [{ id: "bill-1", billNo: "BILL/001", date: "2026-08-01", amount: "100000", tds: "10000", status: "paid" }],
    });
    expect(withBills.success).toBe(true);
    if (withBills.success) expect(withBills.data.bills).toHaveLength(1);
  });
});
