import { describe, expect, it } from "vitest";
import { deviceRegisterResponseSchema, paymentSummarySchema, syncPushRequestSchema, TenderDetailSchema } from "../src/index.js";

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
});
