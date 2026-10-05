import { describe, it, expect } from "vitest";
import {
  confidenceTone, docTypeLabel, hrScannedDocumentsPath, mapHrScannedDocuments, scannedDocumentsView,
} from "./scannedDocuments";

describe("scannedDocumentsView (empty vs error)", () => {
  it("a failed load is an error, never empty; empty only on a successful empty list", () => {
    expect(scannedDocumentsView({ source: "error", data: [] })).toBe("error");
    expect(scannedDocumentsView({ source: "api", data: [] })).toBe("empty");
    expect(scannedDocumentsView({ source: "api", data: [{}] })).toBe("ready");
  });
});

describe("docTypeLabel", () => {
  it("known types map to an i18n key, unknown ones are humanised, never the raw enum", () => {
    expect(docTypeLabel("service_book")).toEqual({ key: "docType_service_book" });
    expect(docTypeLabel("transfer_order")).toEqual({ text: "Transfer order" });
    expect(docTypeLabel("")).toEqual({ text: "—" });
  });
});

describe("confidenceTone", () => {
  it("thresholds and unknown", () => {
    expect(confidenceTone(0.95)).toBe("good");
    expect(confidenceTone(0.9)).toBe("good");
    expect(confidenceTone(0.75)).toBe("warn");
    expect(confidenceTone(0.4)).toBe("bad");
    expect(confidenceTone(null)).toBe("mut");
    expect(confidenceTone(Number.NaN)).toBe("mut");
  });
});

describe("hrScannedDocumentsPath / mapHrScannedDocuments", () => {
  it("encodes the employee id", () => {
    expect(hrScannedDocumentsPath("a/b")).toBe("/api/v1/hrms/employees/a%2Fb/scanned-documents");
  });
  it("normalises a valid payload and rejects a malformed one", () => {
    const ok = mapHrScannedDocuments({ data: [{ id: "1", documentId: "d1", fileName: "a.pdf", docType: "letter", pageCount: 2, ocrConfidence: 0.8, piiFlags: ["pan", 3], textPreviewMasked: "x", filedAt: "2026-01-01T00:00:00Z" }] });
    expect(ok).toEqual([{ id: "1", documentId: "d1", batchId: "", fileName: "a.pdf", mimeType: null, docType: "letter", pageCount: 2, ocrConfidence: 0.8, piiFlags: ["pan"], textPreviewMasked: "x", filedAt: "2026-01-01T00:00:00Z" }]);
    expect(mapHrScannedDocuments({ data: [{ id: 1 }] })).toBeNull();
    expect(mapHrScannedDocuments(null)).toBeNull();
    expect(mapHrScannedDocuments({ data: [] })).toEqual([]);
  });
});
