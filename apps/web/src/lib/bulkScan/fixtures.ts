/** Shared test fixtures for the Bulk scan UI tests (not imported by production code). */
import type { ReviewDetail } from "./types";

export function reviewDetail(over: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    links: [], allowedLinkTargets: null, filingMakerChecker: null,
    file: { id: "f1", batchId: "b1", originalName: "service-book.pdf", state: "needs_review", docType: "service_book", confidence: 0.62, tags: ["hr"], reviewReasons: ["LOW_CONFIDENCE", "MISSING_FIELD:date"], version: 3, link: null },
    pages: [
      {
        pageNumber: 1, width: 1000, height: 500, imageUrl: "https://files.example/p1.png", text: "Service book of XXXX XXXX 1234", meanConfidence: 0.7, orientationDeg: 0, script: "Latn",
        words: [
          { text: "Service", confidence: 0.95, bbox: { x0: 10, y0: 10, x1: 110, y1: 40 } },
          { text: "bok", confidence: 0.35, bbox: { x0: 120, y0: 10, x1: 180, y1: 40 } },
        ],
      },
      { pageNumber: 2, width: 1000, height: 500, imageUrl: null, text: "page two", meanConfidence: 0.8, orientationDeg: 0, script: "Latn", words: [{ text: "two", confidence: 0.9, bbox: { x0: 1, y0: 1, x1: 9, y1: 9 } }] },
    ],
    fields: [
      { kind: "date", value: "01/02/1990", raw: "01/02/90", confidence: 0.9, pageNumber: 1, bbox: null },
      { kind: "aadhaar", value: "XXXX XXXX 1234", raw: null, confidence: 0.99, pageNumber: 1, bbox: null },
      { kind: "amount_inr", value: "125000", raw: null, confidence: 0.8, pageNumber: 1, bbox: null },
    ],
    classification: {
      docType: "service_book", confidence: 0.55, evidence: ["keyword: service book"], uncertain: true, presetDocType: "service_book",
      candidates: [{ docType: "service_book", label: "Service book", score: 0.55 }, { docType: "pay_slip", label: "Pay slip", score: 0.31 }],
    },
    piiFindings: [{ type: "aadhaar", pageNumber: 1, action: "mask", maskedPreview: "XXXX XXXX 1234", bbox: null }],
    degradedPages: [{ pageNumber: 2, reason: "FONT_MISSING", droppedScripts: ["Deva"] }],
    linkSuggestions: [
      { target: "hr_employee", targetId: "e1", label: "EMP-0042 - R. Kumar", confidence: 0.9, amountMinor: null, reference: null, mismatch: false },
      { target: "finance_payment", targetId: "p1", label: "PAY-2026-0091", confidence: 0.8, amountMinor: "999900", reference: "PAY-2026-0091", mismatch: false },
    ],
    docTypes: [{ id: "service_book", label: "Service book" }, { id: "pay_slip", label: "Pay slip" }, { id: "other", label: "Other" }],
    ...over,
  };
}

/** A complete tenant settings object as GET /settings returns it. */
export function settingsObject(): Record<string, unknown> {
  return {
    providerChain: [{ id: "tesseract", timeoutMs: 120000 }],
    languages: ["eng", "hin"], dpi: 300, preprocessingSteps: ["rotate", "deskew", "grayscale", "contrast"], reviewThreshold: 0.8,
    bestOf: { enabled: false, threshold: 0.7 },
    classification: { docTypes: [{ id: "service_book", label: "Service book", keywords: ["service book"], requiredFields: [] }, { id: "other", label: "Other", keywords: [], requiredFields: [] }], uncertainBelow: 0.5, uncertainMargin: 0.2, minScore: 0.3 },
    pii: { policy: { aadhaar: "mask", pan: "flag", bank_account: "flag", phone: "flag", email: "flag" }, reviewOnDetect: false },
    malwareFailClosed: true, duplicatePolicy: "skip",
    limits: { maxFileBytes: 52428800, maxFilesPerBatch: 500, maxBatchBytes: 5368709120 },
    allowedLinkTargets: ["hr_employee", "finance_payment", "finance_voucher", "finance_bill", "eoffice_file"],
    filingMakerChecker: true, retentionDaysByType: {}, concurrency: 2, twoDigitYearPivot: 49, maxAttempts: 5,
  };
}
