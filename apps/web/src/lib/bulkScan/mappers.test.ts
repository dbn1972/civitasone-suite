import { describe, it, expect } from "vitest";
import {
  mapBatch, mapBatchFile, mapBatches, mapLinks, mapLookup, mapProviders, mapReviewDetail, mapReviewQueue, mapSearch, mapSettings, pageInfoOf,
} from "./mappers";
import { reviewDetail, settingsObject } from "./fixtures";

describe("batch mappers", () => {
  it("maps a batch and drops malformed rows instead of failing the page", () => {
    const p = mapBatches({ data: [{ id: "b1", name: "B", status: "processing", counts: { queued: 2, bad: "x" }, progress: { total: 2, settled: 0, percent: 0 }, fileCount: 2, totalBytes: 10 }, { nope: 1 }, "junk"], pagination: { hasMore: true, pageSize: 50 } });
    expect(p?.items).toHaveLength(1);
    expect(p?.items[0]?.counts).toEqual({ queued: 2 });
    expect(p?.page).toEqual({ hasMore: true, pageSize: 50, total: null });
  });
  it("returns null for a payload that is not a list so the loader reports an error", () => {
    expect(mapBatches({ nope: true })).toBeNull();
    expect(mapBatches(null)).toBeNull();
    expect(mapBatch({ id: 1 })).toBeNull();
  });
  it("maps files including the optional link chip", () => {
    const f = mapBatchFile({ id: "f", state: "failed", failureReason: "ENCRYPTED_PDF", originalName: "a.pdf", link: { state: "awaiting_approval", target: "hr_employee", targetId: "e" }, piiFlags: ["aadhaar", 3] });
    expect(f).toMatchObject({ id: "f", state: "failed", failureReason: "ENCRYPTED_PDF", piiFlags: ["aadhaar"], link: { state: "awaiting_approval", target: "hr_employee" } });
    expect(mapBatchFile({ id: "x" })).toBeNull();
  });
  it("pagination info from total/offset", () => {
    expect(pageInfoOf({ pagination: { total: 10, limit: 5, offset: 5 } }, 5)).toMatchObject({ hasMore: false, total: 10 });
    expect(pageInfoOf({ pagination: { total: 10, limit: 5, offset: 0 } }, 5).hasMore).toBe(true);
  });
});

describe("review mappers", () => {
  it("maps the review queue (degradedPages may be a count or a list)", () => {
    const q = mapReviewQueue({ data: [{ batchId: "b", fileId: "f", originalName: "x", degradedPages: [1, 2], reasons: ["LOW_CONFIDENCE"] }, { batchId: "b", fileId: "g", degradedPages: 3 }] });
    expect(q?.items.map((i) => i.degradedPages)).toEqual([2, 3]);
  });
  it("maps a full review detail and sorts candidates best-first, top two only", () => {
    const raw = {
      file: { id: "f1", batchId: "b1", originalName: "a.pdf", state: "needs_review", version: 7, ocrMeanConfidence: 0.5 },
      pages: [{ pageNumber: 2, width: 10, height: 10, text: "t", words: [{ text: "w", confidence: 0.5, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }, { text: "bad" }] }, { pageNumber: 1, width: 0, height: 0 }],
      fields: [{ kind: "date", value: "x", confidence: 1, pageNumber: 1 }],
      classification: { docType: "a", confidence: 0.5, evidence: ["e", { text: "t" }], uncertain: true, presetDocType: "a", candidates: [{ docType: "b", label: "B", score: 0.2 }, { docType: "a", label: "A", score: 0.6 }, { docType: "c", score: 0.1 }] },
      piiFindings: [{ type: "aadhaar", pageNumber: 1, action: "mask", maskedPreview: "XXXX 1234", raw: "123412341234", value: "123412341234" }],
      degradedPages: [{ pageNumber: 2, reason: "FONT", droppedScripts: ["Deva"] }],
      linkSuggestions: [{ target: "finance_payment", targetId: "p", label: "P", amountMinor: 500, mismatch: true }],
      docTypes: [{ id: "a", label: "A" }],
    };
    const d = mapReviewDetail(raw)!;
    expect(d.file).toMatchObject({ version: 7, confidence: 0.5 });
    expect(d.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(d.pages[1]!.words).toHaveLength(1);
    expect(d.pages[0]!.width).toBe(1);
    expect(d.classification.candidates.map((c) => c.docType)).toEqual(["a", "b"]);
    expect(d.classification.evidence).toEqual(["e", "t"]);
    expect(d.classification.presetDocType).toBe("a");
    expect(d.linkSuggestions[0]).toMatchObject({ amountMinor: "500", mismatch: true });
    expect(mapReviewDetail({})).toBeNull();
  });
  it("PII findings carry only the masked preview: no raw value ever reaches the UI model", () => {
    const d = mapReviewDetail({ file: { id: "f" }, piiFindings: [{ type: "aadhaar", maskedPreview: "XXXX 1234", raw: "123412341234", value: "123412341234", text: "123412341234" }] })!;
    expect(JSON.stringify(d.piiFindings)).not.toContain("123412341234");
    expect(Object.keys(d.piiFindings[0]!).sort()).toEqual(["action", "bbox", "maskedPreview", "pageNumber", "type"]);
  });
  it("reads links[], allowedLinkTargets, filingMakerChecker, top-level reasons and the queue batchName", () => {
    const d = mapReviewDetail({ file: { id: "f" }, reasons: ["LOW_CONFIDENCE"], allowedLinkTargets: ["hr_employee", 4], filingMakerChecker: true, links: [{ linkId: "l", target: "hr_employee", targetId: "e", state: "awaiting_approval", resultReason: "AMOUNT_MISMATCH" }, { nope: 1 }] })!;
    expect(d.file.reviewReasons).toEqual(["LOW_CONFIDENCE"]);
    expect(d.allowedLinkTargets).toEqual(["hr_employee"]);
    expect(d.filingMakerChecker).toBe(true);
    expect(d.links).toEqual([{ linkId: "l", target: "hr_employee", targetId: "e", state: "awaiting_approval", reason: null, resultReason: "AMOUNT_MISMATCH" }]);
    expect(mapReviewQueue({ data: [{ batchId: "b", fileId: "f", batchName: "March" }] })?.items[0]?.batchName).toBe("March");
  });
  it("fixture round-trips", () => {
    expect(mapReviewDetail({ file: reviewDetail().file, pages: reviewDetail().pages })?.pages).toHaveLength(2);
  });
});

describe("other mappers", () => {
  it("links, lookup, search, providers", () => {
    expect(mapLinks({ data: [{ linkId: "l", fileId: "f", target: "hr_employee", targetId: "e", state: "awaiting_approval", requestedBy: "u" }, { state: "x" }] })?.items).toHaveLength(1);
    expect(mapLookup({ data: [{ target: "hr_employee", targetId: "e", label: "EMP" }] })?.items).toHaveLength(1);
    expect(mapLookup({ data: [], error: { code: "TARGET_UNAVAILABLE", target: "hr_employee" } })).toEqual({ items: [], error: { code: "TARGET_UNAVAILABLE", target: "hr_employee" } });
    expect(mapLookup({ data: [], error: { code: "WEIRD", target: "x" } })?.error?.code).toBe("UNKNOWN");
    expect(mapLookup({})).toBeNull();
    expect(mapSearch({ data: [{ documentId: "d", fileName: "a.pdf", snippetMasked: "x", links: [{ target: "hr_employee", targetId: "e" }, {}] }] })?.items[0]?.links).toHaveLength(1);
    expect(mapProviders({ data: [{ id: "tesseract", label: "T", available: true, sandbox: false }, { label: "x" }] })).toEqual([{ id: "tesseract", label: "T", available: true, sandbox: false }]);
  });
  it("settings with pending change requests", () => {
    const s = mapSettings({ settings: settingsObject(), version: 4, degraded: false, pendingRequests: [{ id: "c", maker: "u1", sensitive: true, proposed: { a: 1 }, status: "pending", createdAt: "x" }] })!;
    expect(s.version).toBe(4);
    expect(s.pendingRequests[0]).toMatchObject({ id: "c", maker: "u1", sensitive: true });
    expect(mapSettings({ nope: 1 })).toBeNull();
  });
});
