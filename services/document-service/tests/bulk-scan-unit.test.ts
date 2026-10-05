/** bulk-scan: pure unit tests (no DB): state table, magic bytes, limits, settings, backoff, review decision, fairness. */
import { describe, it, expect } from "vitest";
import {
  FILE_STATES, TRANSITIONS, TERMINAL_STATES, canTransition, assertTransition, IllegalTransitionError, isFileState,
  PIPELINE_SETTLED_STATES, type FileState,
} from "../src/modules/bulk-scan/state.js";
import { sniffUpload, isEncryptedPdf, detectMime } from "../src/modules/bulk-scan/magic.js";
import { checkUploadLimits } from "../src/modules/bulk-scan/limits.js";
import {
  settingsSchema, profileConfigSchema, putSettingsBody, uploadUrlsBody, createBatchBody, PREPROCESS_STEPS,
} from "../src/modules/bulk-scan/validators.js";
import { DEFAULT_SETTINGS, applyProfile, isSensitiveChange, parseStoredSettings, changedKeys } from "../src/modules/bulk-scan/settings.js";
import { backoffMs } from "../src/modules/bulk-scan/backoff.js";
import { decideAfterOcr } from "../src/modules/bulk-scan/review.js";
import { fairPick } from "../src/modules/bulk-scan/dispatcher.js";
import { keys, isTenantKey } from "../src/modules/bulk-scan/keys.js";
import { scrubText } from "../src/modules/bulk-scan/scrub.js";
import { refinePreset } from "../src/modules/bulk-scan/classify-preset.js";
import { DEFAULT_CLASSIFIER_CONFIG } from "@civitasone/ocr";

const T = "11111111-aaaa-4000-8000-0000000000a1";
const B = "22222222-aaaa-4000-8000-0000000000b2";
const F = "33333333-aaaa-4000-8000-0000000000c3";

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);
const ascii = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "latin1"));
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);

describe("state machine table", () => {
  it("covers every state and only references known states", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...FILE_STATES].sort());
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      for (const to of tos) expect(isFileState(to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("encodes the documented happy path", () => {
    const path: FileState[] = ["pending_upload", "uploaded", "scanning", "queued", "ocr_running", "extracted", "ready_to_file", "filed"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i] as FileState, path[i + 1] as FileState)).toBe(true);
    expect(canTransition("extracted", "needs_review")).toBe(true);
    expect(canTransition("needs_review", "ready_to_file")).toBe(true);
  });

  it("terminal states have no exits", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["cancelled", "filed", "quarantined", "skipped", "skipped_duplicate"]);
  });

  it("rejects every illegal pair (exhaustive)", () => {
    for (const from of FILE_STATES) {
      for (const to of FILE_STATES) {
        const legal = TRANSITIONS[from].includes(to);
        if (legal) expect(() => assertTransition([from], to)).not.toThrow();
        else expect(() => assertTransition([from], to), `${from} -> ${to}`).toThrow(IllegalTransitionError);
      }
    }
  });

  it("never lets a file skip scanning or leave quarantine", () => {
    expect(canTransition("uploaded", "queued")).toBe(false);
    expect(canTransition("uploaded", "ocr_running")).toBe(false);
    expect(canTransition("scan_pending", "queued")).toBe(false);   // must go back through scanning
    expect(TRANSITIONS.quarantined).toEqual([]);
    expect(canTransition("quarantined", "queued")).toBe(false);
  });

  it("fail-closed hold only returns to scanning, and a failed file retries into the stage that failed", () => {
    expect(TRANSITIONS.scan_pending).toContain("scanning");
    expect(TRANSITIONS.failed).toEqual(["scan_pending", "queued", "skipped"]);
  });

  it("pipeline-settled states exclude in-flight work", () => {
    for (const s of ["pending_upload", "uploaded", "scanning", "scan_pending", "queued", "ocr_running", "extracted"] as const) {
      expect(PIPELINE_SETTLED_STATES).not.toContain(s);
    }
  });

  it("assertTransition checks every candidate source state", () => {
    expect(() => assertTransition(["queued", "failed"], "ocr_running")).toThrow(IllegalTransitionError); // failed -> ocr_running illegal
    expect(() => assertTransition(["queued", "ocr_running"], "failed")).not.toThrow();
  });
});

describe("magic byte validation", () => {
  it("accepts PDF / PNG / JPEG / TIFF (both byte orders) by content", () => {
    expect(sniffUpload(ascii("%PDF-1.7\n1 0 obj"), "application/pdf")).toEqual({ ok: true, mime: "application/pdf" });
    expect(sniffUpload(PNG, "image/png")).toEqual({ ok: true, mime: "image/png" });
    expect(sniffUpload(bytes(0xff, 0xd8, 0xff, 0xe0, 0), "image/jpeg")).toEqual({ ok: true, mime: "image/jpeg" });
    expect(sniffUpload(bytes(0x49, 0x49, 0x2a, 0x00, 8, 0), "image/tiff")).toEqual({ ok: true, mime: "image/tiff" });
    expect(sniffUpload(bytes(0x4d, 0x4d, 0x00, 0x2a, 0, 8), "image/tiff")).toEqual({ ok: true, mime: "image/tiff" });
  });

  it("tolerates a short junk prefix before %PDF- (spec allows 1024 bytes)", () => {
    expect(detectMime(ascii("\r\n\r\n%PDF-1.4 rest"))).toBe("application/pdf");
  });

  it("rejects SVG and markup with a clear reason", () => {
    expect(sniffUpload(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual({ ok: false, reason: "SVG_NOT_ALLOWED" });
    expect(sniffUpload(ascii('  \n<?xml version="1.0"?><svg/>'))).toEqual({ ok: false, reason: "SVG_NOT_ALLOWED" });
    expect(sniffUpload(ascii("<!DOCTYPE html><html></html>"))).toEqual({ ok: false, reason: "SVG_NOT_ALLOWED" });
  });

  it("rejects executables even when declared as a PDF", () => {
    expect(sniffUpload(bytes(0x4d, 0x5a, 0x90, 0x00), "application/pdf")).toEqual({ ok: false, reason: "EXECUTABLE_CONTENT" });         // PE
    expect(sniffUpload(bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1), "application/pdf")).toEqual({ ok: false, reason: "EXECUTABLE_CONTENT" });   // ELF
    expect(sniffUpload(bytes(0xcf, 0xfa, 0xed, 0xfe, 7), "image/png")).toEqual({ ok: false, reason: "EXECUTABLE_CONTENT" });            // Mach-O
    expect(sniffUpload(bytes(0xca, 0xfe, 0xba, 0xbe, 0), "image/png")).toEqual({ ok: false, reason: "EXECUTABLE_CONTENT" });            // fat Mach-O
    expect(sniffUpload(ascii("#!/bin/sh\nrm -rf /"), "application/pdf")).toEqual({ ok: false, reason: "EXECUTABLE_CONTENT" });         // shebang
  });

  it("rejects encrypted PDFs (/Encrypt in the trailer)", () => {
    const enc = ascii("%PDF-1.6\n1 0 obj<<>>endobj\ntrailer<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF");
    expect(isEncryptedPdf(enc)).toBe(true);
    expect(sniffUpload(enc, "application/pdf")).toEqual({ ok: false, reason: "ENCRYPTED_PDF" });
    expect(isEncryptedPdf(ascii("%PDF-1.6\ntrailer<< /Root 1 0 R /EncryptMetadata false >>"))).toBe(false);
  });

  it("rejects empty, unknown and mismatched content", () => {
    expect(sniffUpload(new Uint8Array(0))).toEqual({ ok: false, reason: "EMPTY_FILE" });
    expect(sniffUpload(ascii("plain text, not an image"))).toEqual({ ok: false, reason: "UNSUPPORTED_FILE_TYPE" });
    expect(sniffUpload(ascii("GIF89a....."))).toEqual({ ok: false, reason: "UNSUPPORTED_FILE_TYPE" });
    expect(sniffUpload(PNG, "application/pdf")).toEqual({ ok: false, reason: "MIME_MISMATCH" });
  });
});

describe("upload limits", () => {
  const limits = { maxFileBytes: 100, maxFilesPerBatch: 3, maxBatchBytes: 250 };
  it("passes within limits", () => {
    expect(checkUploadLimits(limits, { fileCount: 0, totalBytes: 0 }, [{ sizeBytes: 100 }, { sizeBytes: 100 }])).toBeNull();
  });
  it("flags an oversize file with its index", () => {
    expect(checkUploadLimits(limits, { fileCount: 0, totalBytes: 0 }, [{ sizeBytes: 10 }, { sizeBytes: 101 }])).toEqual({ code: "FILE_TOO_LARGE", fileIndex: 1, limit: 100 });
  });
  it("counts files already in the batch", () => {
    expect(checkUploadLimits(limits, { fileCount: 2, totalBytes: 0 }, [{ sizeBytes: 1 }, { sizeBytes: 1 }])).toEqual({ code: "TOO_MANY_FILES", limit: 3 });
  });
  it("counts bytes already in the batch", () => {
    expect(checkUploadLimits(limits, { fileCount: 1, totalBytes: 200 }, [{ sizeBytes: 60 }])).toEqual({ code: "BATCH_TOO_LARGE", limit: 250 });
  });
});

describe("settings: safe defaults + validation", () => {
  it("documents the safe defaults", () => {
    const d = settingsSchema.parse({});
    expect(d.providerChain).toEqual([{ id: "tesseract", timeoutMs: 120_000 }]);
    expect(d.languages).toEqual(["eng", "hin"]);
    expect(d.dpi).toBe(300);
    expect(d.reviewThreshold).toBe(0.8);
    expect(d.malwareFailClosed).toBe(true);
    expect(d.duplicatePolicy).toBe("skip");
    expect(d.limits).toEqual({ maxFileBytes: 50 * 1024 * 1024, maxFilesPerBatch: 500, maxBatchBytes: 5 * 1024 * 1024 * 1024 });
    expect(d.concurrency).toBe(2);
    expect(d.twoDigitYearPivot).toBe(49);
    expect(d.allowedLinkTargets).toEqual(["hr_employee", "finance_payment", "finance_voucher", "finance_bill", "eoffice_file"]);
    expect(d.filingMakerChecker).toBe(true);
    expect(d.pii.policy.aadhaar).toBe("mask");
    expect(d.pii.policy.pan).toBe("flag");
    expect(d).toEqual(DEFAULT_SETTINGS);
  });

  it("enforces ranges", () => {
    expect(settingsSchema.safeParse({ dpi: 100 }).success).toBe(false);
    expect(settingsSchema.safeParse({ dpi: 601 }).success).toBe(false);
    expect(settingsSchema.safeParse({ dpi: 150, languages: ["eng"] }).success).toBe(true);
    expect(settingsSchema.safeParse({ reviewThreshold: 1.1 }).success).toBe(false);
    expect(settingsSchema.safeParse({ reviewThreshold: -0.1 }).success).toBe(false);
    expect(settingsSchema.safeParse({ concurrency: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ concurrency: 9 }).success).toBe(false);
    expect(settingsSchema.safeParse({ twoDigitYearPivot: 100 }).success).toBe(false);
    expect(settingsSchema.safeParse({ twoDigitYearPivot: -1 }).success).toBe(false);
    expect(settingsSchema.safeParse({ twoDigitYearPivot: 30.5 }).success).toBe(false);
    expect(settingsSchema.parse({ twoDigitYearPivot: 0 }).twoDigitYearPivot).toBe(0);
    expect(settingsSchema.parse({ twoDigitYearPivot: 99 }).twoDigitYearPivot).toBe(99);
  });

  it("only accepts known providers and languages", () => {
    expect(settingsSchema.safeParse({ providerChain: [{ id: "mystery_ocr" }] }).success).toBe(false);
    expect(settingsSchema.safeParse({ languages: ["klingon"] }).success).toBe(false);
    expect(settingsSchema.safeParse({ providerChain: [{ id: "tesseract" }, { id: "google_docai" }], languages: ["eng", "tam"] }).success).toBe(true);
  });

  it("applies cross-field rules", () => {
    const bad = (o: unknown): boolean => !settingsSchema.safeParse(o).success;
    expect(bad({ bestOf: { enabled: true } })).toBe(true);                                       // best-of with one provider
    expect(bad({ providerChain: [{ id: "tesseract" }, { id: "tesseract" }] })).toBe(true);        // duplicate provider
    expect(bad({ dpi: 150, languages: ["eng", "hin"] })).toBe(true);                              // Indic needs >= 200 dpi
    expect(bad({ preprocessingSteps: ["deskew", "deskew"] })).toBe(true);
    expect(bad({ allowedLinkTargets: ["hr_employee", "hr_employee"] })).toBe(true);
    expect(bad({ retentionDaysByType: { nonexistent_type: 30 } })).toBe(true);
    expect(bad({ classification: { docTypes: [{ id: "letter", label: "Letter" }] } })).toBe(true); // missing 'other'
    expect(bad({ classification: { docTypes: [{ id: "other", label: "A" }, { id: "other", label: "B" }] } })).toBe(true);
    expect(settingsSchema.safeParse({ bestOf: { enabled: true }, providerChain: [{ id: "tesseract" }, { id: "aws_textract" }] }).success).toBe(true);
    expect(settingsSchema.safeParse({ retentionDaysByType: { pay_slip: 365 } }).success).toBe(true);
  });

  it("rejects unknown keys (strict) on write", () => {
    expect(putSettingsBody.safeParse({ settings: { malwareFailClosed: true, surprise: 1 } }).success).toBe(false);
    expect(putSettingsBody.safeParse({ settings: {}, extra: 1 }).success).toBe(false);
  });

  it("flags turning fail-closed OFF as sensitive, and only that", () => {
    const off = settingsSchema.parse({ malwareFailClosed: false });
    expect(isSensitiveChange(DEFAULT_SETTINGS, off)).toBe(true);
    expect(isSensitiveChange(off, DEFAULT_SETTINGS)).toBe(false);
    expect(isSensitiveChange(DEFAULT_SETTINGS, settingsSchema.parse({ dpi: 400 }))).toBe(false);
    expect(changedKeys(DEFAULT_SETTINGS, settingsSchema.parse({ dpi: 400, concurrency: 3 })).sort()).toEqual(["concurrency", "dpi"]);
  });

  it("falls back to safe defaults for a stored document that no longer validates", () => {
    expect(parseStoredSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, degraded: false });
    const r = parseStoredSettings({ dpi: 5, malwareFailClosed: false });
    expect(r.degraded).toBe(true);
    expect(r.settings.malwareFailClosed).toBe(true);
  });

  it("layers a profile over tenant settings and re-validates", () => {
    const eff = applyProfile(DEFAULT_SETTINGS, { languages: ["hin"], dpi: 400, reviewThreshold: 0.6 });
    expect(eff.languages).toEqual(["hin"]);
    expect(eff.dpi).toBe(400);
    expect(eff.reviewThreshold).toBe(0.6);
    expect(eff.malwareFailClosed).toBe(true);                                  // profiles can never touch security settings
    expect(profileConfigSchema.safeParse({ malwareFailClosed: false }).success).toBe(false);
    expect(() => applyProfile(DEFAULT_SETTINGS, { dpi: 150, languages: ["hin"] })).toThrow();
  });

  it("validates batch and upload request bodies", () => {
    expect(createBatchBody.safeParse({ name: " " }).success).toBe(false);
    expect(createBatchBody.safeParse({ name: "Service books 1990", linkTarget: { target: "hr_employee" } }).success).toBe(true);
    expect(createBatchBody.safeParse({ name: "x", linkTarget: { target: "ledger" } }).success).toBe(false);
    expect(uploadUrlsBody.safeParse({ files: [{ name: "a.svg", mimeType: "image/svg+xml", sizeBytes: 10 }] }).success).toBe(false);
    expect(uploadUrlsBody.safeParse({ files: [] }).success).toBe(false);
    const ok = uploadUrlsBody.parse({ files: [{ name: "a\u0000b.pdf", mimeType: "application/pdf", sizeBytes: 10 }] });
    expect(ok.files[0]?.name).toBe("ab.pdf");
    expect(PREPROCESS_STEPS).toContain("deskew");
  });
});

describe("backoff", () => {
  it("grows exponentially, is capped, and jitters within bounds", () => {
    const mid = (): number => 0.5;
    expect(backoffMs(1, { baseMs: 1000, maxMs: 60_000, rand: mid })).toBe(1000);
    expect(backoffMs(2, { baseMs: 1000, maxMs: 60_000, rand: mid })).toBe(2000);
    expect(backoffMs(3, { baseMs: 1000, maxMs: 60_000, rand: mid })).toBe(4000);
    expect(backoffMs(20, { baseMs: 1000, maxMs: 60_000, rand: mid })).toBe(60_000);
    expect(backoffMs(3, { baseMs: 1000, jitter: 0.3, rand: () => 0 })).toBe(2800);
    expect(backoffMs(3, { baseMs: 1000, jitter: 0.3, rand: () => 1 })).toBe(5200);
  });
});

describe("review decision after OCR", () => {
  const s = DEFAULT_SETTINGS;
  const ok = { meanConfidence: 0.95, classification: { docType: "letter", confidence: 0.9, uncertain: false }, fields: [], piiFindings: [] };
  it("files straight away when everything is fine", () => {
    expect(decideAfterOcr(ok, s)).toEqual({ target: "ready_to_file", reasons: [] });
  });
  it("sends low confidence to review", () => {
    expect(decideAfterOcr({ ...ok, meanConfidence: 0.79 }, s).reasons).toEqual(["LOW_CONFIDENCE"]);
    expect(decideAfterOcr({ ...ok, meanConfidence: 0.8 }, s).target).toBe("ready_to_file");
  });
  it("sends uncertain / low-confidence classification to review", () => {
    expect(decideAfterOcr({ ...ok, classification: { docType: "other", confidence: 0.9, uncertain: true } }, s).reasons).toContain("CLASSIFICATION_UNCERTAIN");
    expect(decideAfterOcr({ ...ok, classification: { docType: "letter", confidence: 0.4, uncertain: false } }, s).reasons).toContain("CLASSIFICATION_UNCERTAIN");
  });
  it("sends PII to review only when the policy demands it", () => {
    const withPii = { ...ok, piiFindings: [{ type: "aadhaar" as const }] };
    expect(decideAfterOcr(withPii, s).target).toBe("ready_to_file");
    const strict = settingsSchema.parse({ pii: { reviewOnDetect: true } });
    expect(decideAfterOcr(withPii, strict).reasons).toEqual(["PII_DETECTED"]);
  });
  it("sends a missing required field (per doc type) to review", () => {
    const bill = { ...ok, classification: { docType: "bill_voucher", confidence: 0.9, uncertain: false } };
    expect(decideAfterOcr(bill, s).reasons).toEqual(["MISSING_FIELD:amount_inr"]);
    expect(decideAfterOcr({ ...bill, fields: [{ kind: "amount_inr" as const }] }, s).target).toBe("ready_to_file");
  });
  it("accumulates reasons and surfaces degraded output", () => {
    const r = decideAfterOcr({ ...ok, meanConfidence: 0.1, degraded: ["PDF_OMITTED_UNREDACTABLE_PII"] }, s);
    expect(r.reasons).toEqual(["LOW_CONFIDENCE", "DEGRADED:PDF_OMITTED_UNREDACTABLE_PII"]);
  });
});

describe("dispatcher fairness (fairPick)", () => {
  const q = (n: number, p: string): string[] => Array.from({ length: n }, (_, i) => `${p}${i}`);

  it("round-robins across tenants so a huge tenant cannot starve a small one", () => {
    const queues = new Map<string, string[]>([["A", q(100, "a")], ["B", q(2, "b")], ["C", q(2, "c")]]);
    const limit = new Map([["A", 10], ["B", 10], ["C", 10]]);
    const picks = fairPick(queues, limit, 6);
    expect(picks.map((p) => p.item)).toEqual(["a0", "b0", "c0", "a1", "b1", "c1"]);
  });

  it("respects per-tenant limits and gives the spare slots to others", () => {
    const queues = new Map<string, string[]>([["A", q(100, "a")], ["B", q(100, "b")]]);
    const limit = new Map([["A", 1], ["B", 5]]);
    const picks = fairPick(queues, limit, 6);
    expect(picks.filter((p) => p.tenantId === "A")).toHaveLength(1);
    expect(picks.filter((p) => p.tenantId === "B")).toHaveLength(5);
  });

  it("stops at the global slot budget and handles empty input", () => {
    expect(fairPick(new Map([["A", q(5, "a")]]), new Map([["A", 5]]), 2)).toHaveLength(2);
    expect(fairPick(new Map(), new Map(), 5)).toEqual([]);
    expect(fairPick(new Map([["A", q(5, "a")]]), new Map([["A", 0]]), 5)).toEqual([]);
  });

  it("rotates the starting tenant so service is shared over time", () => {
    const queues = new Map<string, string[]>([["A", q(3, "a")], ["B", q(3, "b")], ["C", q(3, "c")]]);
    const limit = new Map([["A", 3], ["B", 3], ["C", 3]]);
    const first = (start: number): string => fairPick(queues, limit, 1, start)[0]?.tenantId ?? "";
    expect([first(0), first(1), first(2)]).toEqual(["A", "B", "C"]);
  });

  it("preserves per-tenant priority order", () => {
    const queues = new Map<string, string[]>([["A", ["a0", "a1", "a2"]], ["B", ["b0"]]]);
    const picks = fairPick(queues, new Map([["A", 9], ["B", 9]]), 9).filter((p) => p.tenantId === "A").map((p) => p.item);
    expect(picks).toEqual(["a0", "a1", "a2"]);
  });
});

describe("storage keys + scrub", () => {
  it("builds tenant-scoped keys and rejects non-uuid ids", () => {
    expect(keys.original(T, B, F)).toBe(`tenants/${T}/bulk-scan/${B}/${F}/original`);
    expect(keys.quarantine(T, B, F)).toBe(`tenants/${T}/bulk-scan-quarantine/${B}/${F}`);
    expect(() => keys.original("../etc", B, F)).toThrow();
    expect(() => keys.original(T, B, "x/../../y")).toThrow();
  });
  it("isTenantKey only accepts the tenant's own bulk-scan prefixes", () => {
    expect(isTenantKey(T, keys.original(T, B, F))).toBe(true);
    expect(isTenantKey(T, keys.original(B, B, F))).toBe(false);
    expect(isTenantKey(T, `tenants/${T}/documents/x`)).toBe(false);
  });
  it("scrubs PII-shaped strings from free text", () => {
    const s = scrubText("failed for 1234 5678 9012 mail a.b@gov.in pan ABCDE1234F ok");
    expect(s).not.toMatch(/1234 5678 9012/);
    expect(s).not.toMatch(/a\.b@gov\.in/);
    expect(s).not.toMatch(/ABCDE1234F/);
    expect(scrubText("x".repeat(500))).toHaveLength(200);
  });
});

describe("classification settings + preset cross-check", () => {
  it("new settings default from @civitasone/ocr (not duplicated) and are range-checked", () => {
    expect(DEFAULT_SETTINGS.classification.uncertainMargin).toBe(DEFAULT_CLASSIFIER_CONFIG.uncertainMargin);
    expect(DEFAULT_SETTINGS.classification.minScore).toBe(DEFAULT_CLASSIFIER_CONFIG.minConfidence);
    expect(settingsSchema.safeParse({ classification: { uncertainMargin: 1.1 } }).success).toBe(false);
    expect(settingsSchema.safeParse({ classification: { minScore: -0.1 } }).success).toBe(false);
    expect(settingsSchema.parse({ classification: { uncertainMargin: 0.4, minScore: 0.7 } }).classification).toMatchObject({ uncertainMargin: 0.4, minScore: 0.7 });
  });

  it("profiles may override margin / minScore without losing the doc types", () => {
    const eff = applyProfile(DEFAULT_SETTINGS, { classification: { uncertainMargin: 0.6 } });
    expect(eff.classification.uncertainMargin).toBe(0.6);
    expect(eff.classification.minScore).toBe(DEFAULT_SETTINGS.classification.minScore);
    expect(eff.classification.docTypes).toEqual(DEFAULT_SETTINGS.classification.docTypes);
  });

  const pkg = (uncertain: boolean, presetDocType: string | null = "office_order") => ({
    docType: presetDocType ?? "pay_slip", confidence: uncertain ? 0.5 : 0.9, evidence: ["preset:office_order"], uncertain, presetDocType,
    candidates: [{ docType: "pay_slip", label: "Pay slip", score: 8 }, { docType: "office_order", label: "Office order", score: 2 }, { docType: "letter", label: "Letter", score: 1 }],
  });

  it("no preset: result unchanged, candidates trimmed to the top 2", () => {
    const r = refinePreset({ ...pkg(true, null), uncertain: true }, 0.4, 0.5);
    expect(r).toMatchObject({ presetDocType: null, uncertain: true });
    expect(r.candidates?.map((c) => c.docType)).toEqual(["pay_slip", "office_order"]);
  });

  it("preset + agreeing/inconclusive classifier => not uncertain, preset confidence", () => {
    expect(refinePreset(pkg(false), 0.9, 0.5)).toMatchObject({ docType: "office_order", uncertain: false, confidence: 0.9 });
  });

  it("confident disagreement (package says uncertain, classifier confidence >= minScore) stays uncertain with candidates", () => {
    const r = refinePreset(pkg(true), 0.8, 0.5);
    expect(r).toMatchObject({ docType: "office_order", presetDocType: "office_order", uncertain: true });
    expect(r.candidates).toHaveLength(2);
  });

  it("a disagreement whose classifier confidence is below minScore is not confident: the preset stands", () => {
    const r = refinePreset(pkg(true), 0.3, 0.5);
    expect(r.uncertain).toBe(false);
    expect(r.evidence.some((e) => e.startsWith("disagreement-below-minScore"))).toBe(true);
  });

  it("review reasons: preset+agree => no classification review; confident disagreement => CLASSIFICATION_UNCERTAIN; no preset keeps old rule", () => {
    const base = { meanConfidence: 0.95, fields: [], piiFindings: [] };
    expect(decideAfterOcr({ ...base, classification: { docType: "letter", confidence: 1, uncertain: false, presetDocType: "letter" } }, DEFAULT_SETTINGS).reasons).toEqual([]);
    expect(decideAfterOcr({ ...base, classification: { docType: "letter", confidence: 1, uncertain: true, presetDocType: "letter" } }, DEFAULT_SETTINGS).reasons).toEqual(["CLASSIFICATION_UNCERTAIN"]);
    expect(decideAfterOcr({ ...base, classification: { docType: "letter", confidence: 0.3, uncertain: false, presetDocType: null } }, DEFAULT_SETTINGS).reasons).toEqual(["CLASSIFICATION_UNCERTAIN"]);
  });
});
