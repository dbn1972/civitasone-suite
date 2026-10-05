/**
 * REAL OCR end-to-end through ocr-adapter.ts (real tesseract.js + generated fixtures from @civitasone/ocr),
 * driven through the pipeline steps on the real DB: uploaded -> scanning -> queued -> ocr_running -> extracted
 * -> ready_to_file | needs_review. Object store is an in-memory fake; ClamAV is mocked clean.
 *
 * Needs tessdata (eng, hin, osd) and fonts. It is skipped, with a reason, when they are not present:
 *   OCR_TESSDATA_PATH=<dir with eng/hin/osd .traineddata[.gz]>  OCR_PDF_FONT_DIR=<dir with Noto Sans fonts>
 *   OCR_TESSDATA_CACHE=<writable cache dir>
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { runWithTenant } from "@civitasone/db";
import { generateAadhaar } from "@civitasone/ocr";
// The fixture generators ship in the ocr package's dist (not part of its public export map).
import { renderTextPage, makeBornDigitalPdf, makeImageOnlyPdf, findFixtureFont, FIXTURE_TEXT, groundTruth, characterErrorRate } from "../../../packages/ocr/dist/fixtures/index.js";
import { sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/bulk-scan/repo.js";
import { createDispatcher, type DiscoveryPort } from "../src/modules/bulk-scan/dispatcher.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { keys } from "../src/modules/bulk-scan/keys.js";
import { newTenant, newInline, pump, tenantTx, memoryStore, fakeScanner, ingest } from "./bulk-scan-helpers.js";

const TESS = process.env.OCR_TESSDATA_PATH ?? "/tmp/bulk-scan-01-tessdata";
const FONTS = process.env.OCR_PDF_FONT_DIR ?? "/tmp/bulk-scan-01-fonts";
const have = (l: string): boolean => existsSync(`${TESS}/${l}.traineddata.gz`) || existsSync(`${TESS}/${l}.traineddata`);
const missing = !["eng", "hin", "osd"].every(have) ? `tessdata for eng/hin/osd not found in ${TESS} (set OCR_TESSDATA_PATH)` : !existsSync(FONTS) ? `fonts not found in ${FONTS} (set OCR_PDF_FONT_DIR)` : "";

const store = memoryStore();
const { q } = newInline();
const AADHAAR = generateAadhaar("23456789012");
const AADHAAR_GROUPED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;
const EN_LINES = [...FIXTURE_TEXT.eng, `Identity No. ${AADHAAR_GROUPED}`];

function discovery(tenants: string[]): DiscoveryPort {
  return {
    async dueTenants(now) { const o: string[] = []; for (const t of tenants) if ((await tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, 1))).length) o.push(t); return o; },
    dueFiles: (t, now, cap) => tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, cap)),
    async expiredLeases() { return []; },
  };
}
const getFile = (t: string, id: string) => runWithTenant(t, () => repo.getFile(t, id)) as Promise<NonNullable<Awaited<ReturnType<typeof repo.getFile>>>>;
const text = (key: string | null): string => store.objects.get(key as string)?.toString("utf8") ?? "";

async function run(tenant: string, name: string, bytes: Buffer, mime: string, batchOver: Record<string, unknown> = {}) {
  const t0 = Date.now();
  const { fileIds } = await ingest(q, store, tenant, [{ name, bytes, mime }], batchOver);
  const id = fileIds[0] as string;
  const d = createDispatcher({ discovery: discovery([tenant]), slots: 2 });
  for (let i = 0; i < 4; i++) { await pump(q); await d.dispatchOnce(); await pump(q); }
  const row = await getFile(tenant, id);
  const events = (await runWithTenant(tenant, () => repo.listFileEvents(tenant, id))).map((e) => e.toState);
  return { row, events, ms: Date.now() - t0 };
}

let disposeAdapter: (() => Promise<void>) | null = null;
beforeAll(async () => {
  if (missing) return;
  process.env.OCR_TESSDATA_PATH = TESS;
  process.env.OCR_PDF_FONT_DIR = FONTS;
  process.env.OCR_TESSDATA_CACHE = process.env.OCR_TESSDATA_CACHE ?? "/tmp/bulk-scan-01-cache";
  const { createOcrAdapter, disposeOcrAdapter } = await import("../src/modules/bulk-scan/ocr-adapter.js");
  disposeAdapter = disposeOcrAdapter;
  setPorts({ store, scanner: fakeScanner("clean"), ocr: createOcrAdapter(), now: () => new Date() });
}, 60_000);
afterAll(async () => { await disposeAdapter?.(); resetPorts(); await sqlClient.end(); });

// FLAKY-SKIP: environment-gated on tesseract traineddata and fonts (OCR_TESSDATA_PATH, OCR_PDF_FONT_DIR); deterministic when present, not flaky (expires: 2027-10-01)
describe.skipIf(missing !== "")(`real OCR end-to-end via ocr-adapter ${missing ? "(SKIPPED: " + missing + ")" : ""}`, () => {
  const PIPELINE_STATES = ["pending_upload", "uploaded", "scanning", "queued", "ocr_running", "extracted"];

  it("English scanned page (PNG): OCR -> classify -> extract -> PII masked -> derivatives", async () => {
    const font = await findFixtureFont("eng");
    const page = await renderTextPage(EN_LINES, { fontPath: font as string, dpi: 300 });
    const t = newTenant();
    const { row, events, ms } = await run(t, "order.png", page.png, "image/png");
    console.info(`[e2e-ocr] eng png: ${ms} ms, conf=${row.ocrMeanConfidence}, docType=${row.docType}, state=${row.state}, reasons=${JSON.stringify(row.reviewReasons)}`);

    expect(events.slice(0, 6)).toEqual(PIPELINE_STATES);
    expect(["needs_review", "ready_to_file"]).toContain(row.state);
    expect(row.pageCount).toBe(1);
    expect(Number(row.ocrMeanConfidence)).toBeGreaterThan(0.6);
    expect(row.scanStatus).toBe("clean");

    // derivatives under deterministic, tenant-scoped keys
    expect(row.textMaskedKey).toBe(keys.textMasked(t, row.batchId, row.id));
    expect(row.structuredJsonKey).toBe(keys.structuredJson(t, row.batchId, row.id));
    expect(row.searchablePdfKey).toBe(keys.searchablePdf(t, row.batchId, row.id));
    expect(store.objects.get(row.searchablePdfKey as string)?.subarray(0, 5).toString()).toBe("%PDF-");

    const masked = text(row.textMaskedKey);
    expect(masked).toContain("Office Order");
    expect(masked).toMatch(/45,000/);
    const bodyLines = masked.split("\n").map((l) => l.trim()).filter((l) => l && !/Identity/.test(l));
    expect(characterErrorRate(groundTruth("eng"), bodyLines.join("\n"))).toBeLessThan(0.1);
    // PII: the raw Aadhaar appears nowhere (text, JSON, DB columns); only types are flagged
    const everything = masked + text(row.structuredJsonKey) + JSON.stringify(row.extractedFields) + JSON.stringify(row.classification);
    expect(everything).not.toContain(AADHAAR);
    expect(everything).not.toContain(AADHAAR_GROUPED);
    expect(everything.replace(/\s/g, "")).not.toContain(AADHAAR);
    expect(row.piiFlags).toContain("aadhaar");
    expect(JSON.stringify(row.piiFlags)).not.toMatch(/\d{6}/);

    const kinds = (row.extractedFields as { kind: string }[]).map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["date", "amount_inr", "employee_no"]));
    expect(["office_order", "sanction_order"]).toContain(row.docType);
    expect((row.classification as { confidence: number }).confidence).toBeGreaterThan(0);
  }, 240_000);

  it("Hindi scanned page (Devanagari): recognised text, bounded CER, searchable PDF with Devanagari layer", async () => {
    const font = await findFixtureFont("hin");
    const page = await renderTextPage(FIXTURE_TEXT.hin, { fontPath: font as string, dpi: 300 });
    const t = newTenant();
    const { row, events, ms } = await run(t, "hindi.png", page.png, "image/png");
    const masked = text(row.textMaskedKey);
    const cer = characterErrorRate(groundTruth("hin"), masked);
    console.info(`[e2e-ocr] hin png: ${ms} ms, conf=${row.ocrMeanConfidence}, cer=${cer.toFixed(3)}, docType=${row.docType}, state=${row.state}`);

    expect(events).toEqual(expect.arrayContaining(PIPELINE_STATES));
    expect(["needs_review", "ready_to_file"]).toContain(row.state);
    expect(Number(row.ocrMeanConfidence)).toBeGreaterThan(0.4);
    expect(cer).toBeLessThan(0.35);
    expect(masked).toMatch(/[ऀ-ॿ]{3,}/);
    expect(text(row.structuredJsonKey)).toContain('"schemaVersion":1');
    expect(row.piiFlags).toEqual([]);
    expect(store.objects.get(row.searchablePdfKey as string)?.subarray(0, 5).toString()).toBe("%PDF-");
  }, 240_000);

  it("born-digital PDF: embedded text layer used (OCR skipped), high confidence, PII masked", async () => {
    const lines = [...FIXTURE_TEXT.eng.slice(0, 3), "Employee ID EMP-20431 posted to the Accounts Branch", `Identity No. ${AADHAAR_GROUPED}`];
    const pdf = Buffer.from(await makeBornDigitalPdf(lines));
    const t = newTenant();
    const { row, events, ms } = await run(t, "born-digital.pdf", pdf, "application/pdf");
    console.info(`[e2e-ocr] born-digital pdf: ${ms} ms, conf=${row.ocrMeanConfidence}, docType=${row.docType}, state=${row.state}, reasons=${JSON.stringify(row.reviewReasons)}`);

    expect(events).toEqual(expect.arrayContaining(PIPELINE_STATES));
    expect(["needs_review", "ready_to_file"]).toContain(row.state);
    const json = JSON.parse(text(row.structuredJsonKey)) as { pages: { source: string }[]; pageCount: number };
    expect(json.pageCount).toBe(1);
    expect(json.pages[0]?.source).toBe("pdf_text_layer");
    expect(Number(row.ocrMeanConfidence)).toBeGreaterThanOrEqual(0.9);
    const masked = text(row.textMaskedKey);
    expect(masked).toContain("Sanction is hereby accorded");
    expect(masked).not.toContain(AADHAAR_GROUPED);
    expect(masked).toMatch(/XXXX XXXX \d{4}/);
    expect(row.piiFlags).toEqual(["aadhaar"]);
    expect((row.extractedFields as { kind: string }[]).map((f) => f.kind)).toEqual(expect.arrayContaining(["date", "employee_no"]));
  }, 240_000);

  it("image-only (scanned) PDF goes through OCR and the same pipeline", async () => {
    const font = await findFixtureFont("eng");
    const page = await renderTextPage(FIXTURE_TEXT.eng, { fontPath: font as string, dpi: 300 });
    const pdf = Buffer.from(await makeImageOnlyPdf([page]));
    const t = newTenant();
    const { row, events, ms } = await run(t, "scan.pdf", pdf, "application/pdf");
    console.info(`[e2e-ocr] image-only pdf: ${ms} ms, conf=${row.ocrMeanConfidence}, state=${row.state}`);
    expect(events).toEqual(expect.arrayContaining(PIPELINE_STATES));
    expect(["needs_review", "ready_to_file"]).toContain(row.state);
    expect(text(row.textMaskedKey)).toContain("Sanction");
    expect(JSON.parse(text(row.structuredJsonKey)).pages[0].source).toBe("ocr");
  }, 240_000);

  it("batch doc-type PRESET decides doc_type; classifier only cross-checks => no classification review, top-2 candidates persisted", async () => {
    const font = await findFixtureFont("eng");
    const page = await renderTextPage(EN_LINES, { fontPath: font as string, dpi: 300 });
    const t = newTenant();
    const { row, ms } = await run(t, "preset.png", page.png, "image/png", { defaultDocType: "office_order" });
    const cls = row.classification as { docType: string; presetDocType: string; uncertain: boolean; candidates: { docType: string; score: number }[] };
    console.info(`[e2e-ocr] eng png + preset: ${ms} ms, state=${row.state}, reasons=${JSON.stringify(row.reviewReasons)}, candidates=${JSON.stringify(cls.candidates)}`);
    expect(row.docType).toBe("office_order");
    expect(cls).toMatchObject({ docType: "office_order", presetDocType: "office_order", uncertain: false });
    expect(cls.candidates.length).toBeGreaterThanOrEqual(1);
    expect(cls.candidates.length).toBeLessThanOrEqual(2);
    expect(row.reviewReasons).not.toContain("CLASSIFICATION_UNCERTAIN");
    expect(row.state).toBe("ready_to_file");
  }, 240_000);

  it("born-digital PDF with a preset goes straight to ready_to_file", async () => {
    const pdf = Buffer.from(await makeBornDigitalPdf(FIXTURE_TEXT.eng));
    const t = newTenant();
    const { row } = await run(t, "preset.pdf", pdf, "application/pdf", { defaultDocType: "office_order" });
    expect(row.reviewReasons).toEqual([]);
    expect(row.state).toBe("ready_to_file");
    expect((row.classification as { presetDocType: string }).presetDocType).toBe("office_order");
  }, 240_000);

  it("WITHOUT a preset the classifier decides; candidates (top-2) are persisted and docType is a configured type", async () => {
    const font = await findFixtureFont("eng");
    const page = await renderTextPage(FIXTURE_TEXT.eng, { fontPath: font as string, dpi: 300 });
    const t = newTenant();
    const { row, ms } = await run(t, "nopreset.png", page.png, "image/png");
    const cls = row.classification as { docType: string; confidence: number; uncertain: boolean; presetDocType: string | null; candidates: unknown[] };
    console.info(`[e2e-ocr] eng png, no preset: ${ms} ms, docType=${cls.docType}, conf=${cls.confidence}, uncertain=${cls.uncertain}, state=${row.state}`);
    expect(cls.presetDocType).toBeNull();
    expect(cls.candidates.length).toBeGreaterThanOrEqual(1);
    expect(["office_order", "sanction_order"]).toContain(cls.docType);
    expect(["needs_review", "ready_to_file"]).toContain(row.state);
    // routing is consistent with the classifier's own verdict
    expect(row.reviewReasons?.includes("CLASSIFICATION_UNCERTAIN")).toBe(cls.uncertain || cls.confidence < 0.5);
  }, 240_000);

  it("WITHOUT a preset a clean, typical page (pay slip) is classified confidently and filed without review", async () => {
    const font = await findFixtureFont("eng");
    const lines = ["Pay Slip for the month of March 2024", "Salary slip of Employee ID EMP-20431", "Basic Pay Rs. 52,000", "Net Pay Rs. 48,500 credited"];
    const page = await renderTextPage(lines, { fontPath: font as string, dpi: 300 });
    const t = newTenant();
    const { row, ms } = await run(t, "payslip.png", page.png, "image/png");
    const cls = row.classification as { docType: string; confidence: number; uncertain: boolean; candidates: unknown[] };
    console.info(`[e2e-ocr] pay slip, no preset: ${ms} ms, docType=${cls.docType}, conf=${cls.confidence}, uncertain=${cls.uncertain}, state=${row.state}, reasons=${JSON.stringify(row.reviewReasons)}`);
    expect(cls.docType).toBe("pay_slip");
    expect(cls.uncertain).toBe(false);
    expect(row.reviewReasons).not.toContain("CLASSIFICATION_UNCERTAIN");
    expect(row.state).toBe("ready_to_file");
  }, 240_000);
});
