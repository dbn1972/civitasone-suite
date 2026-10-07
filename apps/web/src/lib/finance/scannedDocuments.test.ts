import { describe, it, expect } from "vitest";
import { formatMoney } from "@/lib/formatters";
import { scannedDocumentsEndpoint, mapScannedDocuments } from "./scannedDocuments";

describe("scannedDocumentsEndpoint", () => {
  it("builds the read path with encoding", () => {
    expect(scannedDocumentsEndpoint("bills", "abc/1")).toBe("/v1/finance/bills/abc%2F1/scanned-documents");
  });
});

describe("mapScannedDocuments (paise stay exact strings)", () => {
  const row = { id: "1", documentId: "d", batchId: "b", fileName: "scan.pdf", mimeType: "application/pdf", docType: "bill_voucher", pageCount: 2,
    ocrConfidence: 0.91, piiFlags: ["pan"], textPreviewMasked: "x", matchedReference: "BILL-1", matchedAmountMinor: "1234567890123",
    linkId: "l", linkedBy: "u", approvedBy: null, filedAt: null, linkedAt: "2026-10-01T00:00:00.000Z" };
  it("keeps 1,234,567,890,123 paise exact and formats it without float rounding", () => {
    const [d] = mapScannedDocuments({ data: [row] })!;
    expect(d!.matchedAmountMinor).toBe("1234567890123");
    expect(formatMoney(d!.matchedAmountMinor)).toBe("₹12,34,56,78,901.23");
  });
  it("drops non-integer amount strings and returns null for a malformed body", () => {
    expect(mapScannedDocuments({ data: [{ ...row, matchedAmountMinor: "12.5" }] })![0]!.matchedAmountMinor).toBeNull();
    expect(mapScannedDocuments({ nope: 1 })).toBeNull();
    expect(mapScannedDocuments({ data: [{ id: 1 }] })).toBeNull();
  });
});
