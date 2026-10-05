import { describe, it, expect } from "vitest";
import { estabScannedDocumentsPath, mapEstabScannedDocuments, scannedDocumentsView } from "./scannedDocuments";

const row = {
  id: "11111111-1111-4111-8111-111111111111", linkId: "22222222-2222-4222-8222-222222222222",
  documentId: "33333333-3333-4333-8333-333333333333", batchId: "44444444-4444-4444-8444-444444444444",
  fileName: "order.pdf", mimeType: "application/pdf", docType: "office_order", pageCount: 2, ocrConfidence: 0.91,
  piiFlags: ["pan"], textPreviewMasked: "masked", linkedBy: "u1", approvedBy: null, filedAt: "2026-10-01T00:00:00.000Z",
};

describe("estab scanned documents helpers", () => {
  it("builds the read path with an encoded id", () => {
    expect(estabScannedDocumentsPath("a/b")).toBe("/api/v1/estab/files/a%2Fb/scanned-documents");
  });

  it("maps a valid payload and normalises optional fields", () => {
    const out = mapEstabScannedDocuments({ data: [row, { id: "x", documentId: "y", fileName: "z.pdf", piiFlags: [1, "aadhaar"] }] });
    expect(out).toHaveLength(2);
    expect(out![0]).toMatchObject({ fileName: "order.pdf", ocrConfidence: 0.91, piiFlags: ["pan"] });
    expect(out![1]).toMatchObject({ docType: "other", pageCount: 0, ocrConfidence: null, piiFlags: ["aadhaar"], mimeType: null });
  });

  it("rejects malformed bodies so the loader reports an error rather than an empty list", () => {
    expect(mapEstabScannedDocuments(null)).toBeNull();
    expect(mapEstabScannedDocuments({})).toBeNull();
    expect(mapEstabScannedDocuments({ data: [{ id: 1 }] })).toBeNull();
  });

  it("separates error from empty from ready (a failed load is never 'no documents')", () => {
    expect(scannedDocumentsView({ source: "error", data: [] })).toBe("error");
    expect(scannedDocumentsView({ source: "api", data: [] })).toBe("empty");
    expect(scannedDocumentsView({ source: "api", data: [row] })).toBe("ready");
  });
});
