/** Real pipeline proof on eng: formats (PNG/TIFF/PDF) -> processDocument(tesseract) -> classify/extract/PII/outputs. */
import { afterAll, describe, expect, it } from "vitest";
import { OcrChain } from "../../src/chain.js";
import { processDocument } from "../../src/process.js";
import { TesseractProvider } from "../../src/providers/tesseract.js";
import {
  FIXTURE_TEXT, makeBornDigitalPdf, makeImageOnlyPdf, makeLanguageFixture, pngsToMultiPageTiff, renderTextPage,
} from "../../src/fixtures/index.js";
import { buildSearchablePdf, toPlainText, toStructuredJson } from "../../src/output/index.js";
import { classify, detectPiiInPages, extractFields, generateAadhaar } from "../../src/post/index.js";
import { pdfTextItems } from "../output/pdftext.js";
import { ensureTessdata, tessdataDir } from "./setup.js";

const provider = new TesseractProvider({ maxWorkers: 2, tessdataPath: tessdataDir(), idleTimeoutMs: 0 });
const chain = new OcrChain({ providers: [{ provider }], langs: ["eng"] });
afterAll(async () => { await provider.dispose(); });
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

describe("eng end-to-end (real tesseract)", () => {
  it("PNG / multi-page TIFF / image-only PDF / born-digital PDF all yield the known text; downstream post-processing works", async (ctx) => {
    const missing = await ensureTessdata("eng");
    if (missing) { process.stdout.write(`E2E skipped reason=${missing}\n`); ctx.skip(); return; }
    const fx = await makeLanguageFixture("eng");
    if ("unavailable" in fx) { ctx.skip(); return; }
    const aad = generateAadhaar("23456789012");
    const lines = [...FIXTURE_TEXT.eng, `Aadhaar ${aad.slice(0, 4)} ${aad.slice(4, 8)} ${aad.slice(8)}`, "PAN ABCPE1234F"];
    const page = await renderTextPage(lines, { fontPath: fx.fontPath, dpi: 300, fontSizePt: 14 });
    const second = await renderTextPage(["Pay slip for March 2024", "Basic Pay 45000 Net Pay 40000 Deductions 5000"], { fontPath: fx.fontPath, dpi: 300, fontSizePt: 14 });

    // multi-page TIFF (own encoder) => 2 pages
    const tiff = await pngsToMultiPageTiff([page.png, second.png]);
    const t = await processDocument({ data: tiff }, { chain, orientationDetector: null });
    expect(t.kind).toBe("tiff");
    expect(t.result.pageCount).toBe(2);
    expect(norm(t.result.pages[1]?.text ?? "")).toContain("Pay slip for March 2024");

    // image-only PDF => rasterised + OCR'd
    const scan = await makeImageOnlyPdf([page, second]);
    const s = await processDocument({ data: scan }, { chain, orientationDetector: null });
    expect(s.kind).toBe("pdf");
    expect(s.result.pages.every((p) => p.source === "ocr")).toBe(true);
    expect(norm(s.result.pages[0]?.text ?? "")).toContain("Office Order No. 12/2024");

    // born-digital PDF => text layer used, OCR skipped
    const bd = await processDocument({ data: await makeBornDigitalPdf(FIXTURE_TEXT.eng) }, { chain, orientationDetector: null });
    expect(bd.result.pages[0]?.source).toBe("pdf_text_layer");

    // post-processing on REAL OCR output
    const ocr = t.result;
    const fields = extractFields(ocr.pages);
    const cls = classify(ocr.pages, undefined, { fields });
    const pii = detectPiiInPages(ocr.pages);
    process.stdout.write(`E2E classify=${cls.docType} conf=${cls.confidence} fields=${fields.map((f) => `${f.kind}:${f.value}`).join(",")} pii=${pii.map((p) => `${p.type}@${p.bbox ? "bbox" : "nobbox"}`).join(",")}\n`);
    expect(fields.find((f) => f.kind === "date")?.value).toBe("2024-03-15");
    expect(fields.find((f) => f.kind === "amount_inr")?.value).toBe("4500000");
    expect(fields.find((f) => f.kind === "employee_no")?.value).toBe("EMP-20431");
    expect(pii.some((p) => p.type === "aadhaar")).toBe(true);
    expect(pii.find((p) => p.type === "aadhaar")?.bbox).not.toBeNull();
    expect(JSON.stringify(toStructuredJson(ocr, { fields, classification: cls, pii }))).not.toContain(aad);
    expect(toPlainText(ocr, pii)).not.toContain(aad.slice(0, 4) + " " + aad.slice(4, 8));

    // searchable PDF (masked) round-trips through pdfjs and through our own text-layer fast path
    const sp = await buildSearchablePdf(t.pages, ocr.pages, { pii });
    expect(sp.degradedPages).toEqual([]);
    const layer = ((await pdfTextItems(sp.pdf))[0] ?? []).map((i) => i.str).join(" ");
    expect(layer).toContain("Order");
    expect(layer).not.toContain(aad.slice(0, 4));
    const again = await processDocument({ data: sp.pdf }, { chain, orientationDetector: null });
    expect(again.result.pages[0]?.source).toBe("pdf_text_layer");
    expect(norm(again.result.pages[0]?.text ?? "")).toContain("Office Order");
  }, 300_000);
});
