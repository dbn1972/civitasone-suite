import { describe, it, expect } from "vitest";
import {
  scannedDocumentsView, scannedDocumentDownloadPath, formatConfidencePct, extractDownloadUrl, downloadFailureFor, docTypeLabel, piiTypeLabel,
} from "./scannedDocuments";

describe("scannedDocumentsView (empty vs error)", () => {
  it("an API failure is an error, never empty", () => {
    expect(scannedDocumentsView({ source: "error", data: [] })).toBe("error");
  });
  it("a successful empty list is empty; a non-empty one is ready", () => {
    expect(scannedDocumentsView({ source: "api", data: [] })).toBe("empty");
    expect(scannedDocumentsView({ source: "api", data: [{}] })).toBe("ready");
  });
});

describe("download path", () => {
  it("builds the BFF download path with encoding", () => {
    expect(scannedDocumentDownloadPath("d-1")).toBe("/api/proxy/v1/documents/bulk-scan/files/d-1/download");
    expect(scannedDocumentDownloadPath("a/b")).toBe("/api/proxy/v1/documents/bulk-scan/files/a%2Fb/download");
  });
});

describe("formatConfidencePct", () => {
  it("rounds a ratio to a percent and handles unknowns", () => {
    expect(formatConfidencePct(0.9123)).toBe("91%");
    expect(formatConfidencePct(1.4)).toBe("100%");
    expect(formatConfidencePct(null)).toBe("—");
    expect(formatConfidencePct(Number.NaN)).toBe("—");
  });
});

describe("extractDownloadUrl", () => {
  it("accepts https and same-origin paths, rejects other schemes and protocol-relative URLs", () => {
    expect(extractDownloadUrl({ downloadUrl: "https://s3.example/x?sig=1" })).toBe("https://s3.example/x?sig=1");
    expect(extractDownloadUrl({ data: { url: "/api/files/1" } })).toBe("/api/files/1");
    expect(extractDownloadUrl({ downloadUrl: "javascript:alert(1)" })).toBeNull();
    expect(extractDownloadUrl({ downloadUrl: "//evil.example/x" })).toBeNull();
    expect(extractDownloadUrl(null)).toBeNull();
  });
});

describe("downloadFailureFor", () => {
  it("maps 403/404/other", () => {
    expect(downloadFailureFor(403)).toBe("forbidden");
    expect(downloadFailureFor(404)).toBe("notFound");
    expect(downloadFailureFor(500)).toBe("failed");
  });
});


describe("doc type / PII type labels", () => {
  it("known types map to an i18n key (translated in en and hi), unknown ones to a humanised fallback", () => {
    expect(docTypeLabel("service_book")).toEqual({ key: "docType_service_book" });
    expect(docTypeLabel("transfer_order")).toEqual({ text: "Transfer order" });
    expect(docTypeLabel("")).toEqual({ text: "—" });
    expect(piiTypeLabel("aadhaar")).toEqual({ key: "pii_aadhaar" });
    expect(piiTypeLabel("bank_account")).toEqual({ key: "pii_bank_account" });
    expect(piiTypeLabel("passport_no")).toEqual({ text: "Passport no" });
  });
});
