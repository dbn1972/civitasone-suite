import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSearchablePdf, dominantScript, maskPageResult, toPlainText, toStructuredJson } from "../../src/output/index.js";
import { detectPiiInPages } from "../../src/post/pii.js";
import { generateAadhaar } from "../../src/post/verhoeff.js";
import { classify } from "../../src/post/classify.js";
import { extractFields } from "../../src/post/extract.js";
import { findFixtureFont, renderTextPage } from "../../src/fixtures/index.js";
import type { DocumentOcrResult, PageImage, PageResult, PiiPolicy } from "../../src/types.js";
import { makePage } from "../post/helpers.js";
import { pdfTextItems, rawContent } from "./pdftext.js";

const AAD = generateAadhaar("23456789012");
const AAD_SP = `${AAD.slice(0, 4)} ${AAD.slice(4, 8)} ${AAD.slice(8)}`;
const doc = (pages: PageResult[]): DocumentOcrResult => ({
  pages, text: pages.map((p) => p.text).join("\f"), meanConfidence: 0.95, providerIds: ["tesseract"], pageCount: pages.length,
});

describe("toPlainText / maskPageResult / toStructuredJson", () => {
  const p1 = makePage([`Name Ravi Kumar`, `Aadhaar ${AAD_SP}`, `PAN ABCPE1234F`], 1);
  const p2 = makePage([`Second page 12/03/2024`], 2);
  const result = doc([p1, p2]);
  const findings = detectiveFindings();

  function detectiveFindings() {
    return detectPiiInPages(result.pages);
  }

  it("joins pages with form-feed and applies masks (Aadhaar masked, PAN flag-only stays)", () => {
    const t = toPlainText(result, findings);
    expect(t.split("\f")).toHaveLength(2);
    expect(t).toContain(`XXXX XXXX ${AAD.slice(-4)}`);
    expect(t).not.toContain(AAD_SP);
    expect(t).toContain("ABCPE1234F");
    expect(toPlainText(result)).toContain(AAD_SP); // no findings supplied => untouched
  });

  it("maskPageResult masks words/lines/blocks by bbox, leaves other pages alone", () => {
    const masked = maskPageResult(p1, findings);
    const dump = JSON.stringify(masked);
    expect(dump).not.toContain(AAD.slice(0, 4));
    expect(dump).not.toContain(AAD.slice(4, 8));
    expect(dump).toContain("ABCPE1234F");
    expect(maskPageResult(p2, findings)).toBe(p2);
  });

  it("unlocatable (no-bbox) mask findings fall back to line re-scan so nothing leaks", () => {
    const noBox = findings.map((f) => ({ ...f, bbox: null }));
    expect(JSON.stringify(maskPageResult(p1, noBox))).not.toContain(AAD_SP);
  });

  it("structured JSON: pages/blocks/lines/words/bboxes/fields/classification/pii TYPES only", () => {
    const fields = extractFields(result.pages);
    const cls = classify(result.pages);
    const json = toStructuredJson(result, { fields, classification: cls, pii: findings, metadata: { documentId: "d1" } });
    const s = JSON.stringify(json);
    expect(json.schemaVersion).toBe(1);
    expect(json.pages).toHaveLength(2);
    expect(json.pages[0]?.blocks[0]?.lines[0]?.words?.[0]?.bbox).toEqual({ x0: 20, y0: 20, x1: 60, y1: 40 });
    expect(json.pii.types).toEqual(["aadhaar", "pan"]);
    expect(json.pii.countsByType.aadhaar).toBe(1);
    expect(json.classification).toEqual(cls);
    expect(json.fields.some((f) => f.kind === "date")).toBe(true);
    expect(json.metadata).toEqual({ documentId: "d1" });
    expect(s).not.toContain(AAD);
    expect(s).not.toContain(AAD_SP);
    expect(JSON.parse(s)).toEqual(json);
    expect(toStructuredJson(result, { includeWords: false }).pages[0]?.blocks[0]?.lines[0]?.words).toBeUndefined();
  });
});

async function imageFor(page: PageResult, w = 1240, h = 400): Promise<PageImage> {
  const sharp = (await import("sharp")) as unknown as { default: (o: unknown) => { png(): { toBuffer(): Promise<Buffer> } } };
  const data = await sharp.default({ create: { width: w, height: h, channels: 3, background: "#fff" } }).png().toBuffer();
  return { pageNumber: page.pageNumber, data: new Uint8Array(data), mimeType: "image/png", width: w, height: h, dpi: 150 };
}

describe("buildSearchablePdf (Latin)", () => {
  const lines = ["Office Order No. 12/2024 dated 15 March 2024", "Employee EMP-20431 Rs. 45,000"];
  const page = makePage(lines, 1);

  it("embeds an invisible (Tr 3) text layer that a PDF reader can re-extract and that matches the OCR words", async () => {
    const r = await buildSearchablePdf([await imageFor(page)], [page]);
    expect(r.degradedPages).toEqual([]);
    expect(r.textLayerPages).toEqual([1]);
    expect(await rawContent(r.pdf)).toContain("3 Tr");
    const items = (await pdfTextItems(r.pdf))[0] ?? [];
    const expectedWords = lines.join(" ").split(/\s+/);
    expect(items.map((i) => i.str)).toEqual(expectedWords);
    // geometry: word positions follow bbox (pt = px * 72/150); y flipped
    const first = items[0];
    expect(first?.x).toBeCloseTo(20 * (72 / 150), 1);
  });

  it("applies the PII mask policy: text layer holds masked text only", async () => {
    const pg = makePage([`Aadhaar ${AAD_SP} ok`], 1);
    const findings = detectiveFor([pg]);
    const r = await buildSearchablePdf([await imageFor(pg)], [pg], { pii: findings });
    const text = ((await pdfTextItems(r.pdf))[0] ?? []).map((i) => i.str).join(" ");
    expect(text).not.toContain(AAD.slice(0, 4));
    expect(text).not.toContain(AAD.slice(-4));
    expect(text).toContain("ok");
    expect(await rawContent(r.pdf)).not.toContain(AAD);
  });

  it("pages without an OCR result are image-only; TIFF input is transcoded", async () => {
    const sharp = (await import("sharp")) as unknown as { default: (o: unknown) => { tiff(): { toBuffer(): Promise<Buffer> } } };
    const tiff = await sharp.default({ create: { width: 300, height: 200, channels: 3, background: "#fff" } }).tiff().toBuffer();
    const img: PageImage = { pageNumber: 2, data: new Uint8Array(tiff), mimeType: "image/tiff", width: 300, height: 200, dpi: 100 };
    const r = await buildSearchablePdf([await imageFor(page), img], [page]);
    expect(r.pageCount).toBe(2);
    expect(r.textLayerPages).toEqual([1]);
    expect((await pdfTextItems(r.pdf))[1]).toEqual([]);
  });

  it("reports Devanagari pages as degraded (Latin-only layer) when no font is configured", async () => {
    const hi = makePage(["Order आदेश 12 dated 15/03/2024"], 1);
    const r = await buildSearchablePdf([await imageFor(hi)], [hi], { fontDir: "/nonexistent-bulk-scan-01" });
    expect(r.degradedPages).toHaveLength(1);
    expect(r.degradedPages[0]).toMatchObject({ pageNumber: 1, droppedScripts: ["Devanagari"] });
    const text = ((await pdfTextItems(r.pdf))[0] ?? []).map((i) => i.str).join(" ");
    expect(text).toContain("Order");
    expect(text).not.toContain("आदेश");
  });

  it("dominantScript", () => {
    expect(dominantScript("hello")).toBe("Latin");
    expect(dominantScript("कार्यालय")).toBe("Devanagari");
    expect(dominantScript("১২")).toBe("Latin"); // digits alone are neutral
    expect(dominantScript("தமிழ்")).toBe("Tamil");
  });
});

function detectiveFor(pages: PageResult[]) {
  const policy: PiiPolicy = { aadhaar: "mask", pan: "flag", bank_account: "flag", phone: "flag", email: "flag" };
  return detectPiiInPages(pages, policy);
}

// ---- Per-script text layer: runs for every script whose Noto font is in the font dir (see scripts/fetch-fonts.mjs)
const FONT_DIR = process.env["OCR_PDF_FONT_DIR"] ?? join(tmpdir(), "bulk-scan-01-fonts");
const SCRIPT_SAMPLES: Record<string, { file: string; words: string[] }> = {
  Latin: { file: "NotoSansLatin", words: ["Office", "Order", "No.", "12/2024", "dated", "15", "March"] },
  Devanagari: { file: "NotoSansDevanagari", words: ["कार्यालय", "आदेश", "संख्या", "12", "मार्च", "2024", "स्वीकृति", "प्रभाव"] },
  Bengali: { file: "NotoSansBengali", words: ["সরকারি", "কার্যালয়ের", "আদেশ", "নম্বর", "অনুমোদন", "কার্যকর"] },
  Tamil: { file: "NotoSansTamil", words: ["அரசு", "அலுவலக", "உத்தரவு", "எண்", "அனுமதி", "வழங்கப்படுகிறது"] },
  Telugu: { file: "NotoSansTelugu", words: ["ప్రభుత్వ", "కార్యాలయ", "ఆదేశం", "సంఖ్య", "అనుమతి", "మంజూరు"] },
  Gujarati: { file: "NotoSansGujarati", words: ["સરકારી", "કચેરીનો", "આદેશ", "ક્રમાંક", "મંજૂરી", "અમલમાં"] },
  Kannada: { file: "NotoSansKannada", words: ["ಕಾರ್ಯಾಲಯ", "ಆದೇಶ", "ಸಂಖ್ಯೆ", "ಸರ್ಕಾರಿ", "ಮಂಜೂರು"] },
  Malayalam: { file: "NotoSansMalayalam", words: ["ഓഫീസ്", "ഉത്തരവ്", "നമ്പർ", "സർക്കാർ", "അനുമതി"] },
  Gurmukhi: { file: "NotoSansGurmukhi", words: ["ਦਫ਼ਤਰ", "ਆਦੇਸ਼", "ਨੰਬਰ", "ਸਰਕਾਰੀ", "ਮਨਜ਼ੂਰੀ"] },
  Odia: { file: "NotoSansOdia", words: ["କାର୍ଯ୍ୟାଳୟ", "ଆଦେଶ", "ସଂଖ୍ୟା", "ସରକାରୀ", "ଅନୁମତି"] },
  Arabic: { file: "NotoNaskhArabic", words: ["دفتری", "حکم", "نامہ", "منظوری", "سرکاری"] },
};

describe.each(Object.entries(SCRIPT_SAMPLES))("searchable PDF text layer: %s", (script, sample) => {
  const fontPath = join(FONT_DIR, `${sample.file}-Regular.ttf`);
  const present = existsSync(fontPath);
  // FLAKY-SKIP: environment-gated, deterministic when the Noto font for this script is installed (scripts/fetch-fonts.mjs); not a flaky test (expires: 2027-10-01)
  it.skipIf(!present)(`pdfjs re-extracts the exact ${script} Unicode text`, async () => {
    const pg = makePage([sample.words.join(" ")], 1);
    const r = await buildSearchablePdf([await imageFor(pg)], [pg], { fontPaths: { [script]: fontPath } });
    const got = ((await pdfTextItems(r.pdf))[0] ?? []).map((i) => i.str.normalize("NFC"));
    process.stdout.write(`SCRIPT_PROOF ${script} degraded=${JSON.stringify(r.degradedPages)} match=${JSON.stringify(got) === JSON.stringify(sample.words.map((w) => w.normalize("NFC")))}\n`);
    expect(r.degradedPages).toEqual([]);
    expect(got).toEqual(sample.words.map((w) => w.normalize("NFC")));
  });
  // FLAKY-SKIP: placeholder that only reports a missing optional font; runs exactly when the proof test above is skipped (expires: 2027-10-01)
  it.skipIf(present)(`SKIPPED ${script}: font ${fontPath} absent (run scripts/fetch-fonts.mjs)`, () => undefined);
});

describe("renderTextPage smoke (latin)", () => {
  it("renders non-blank black-on-white", async () => {
    const font = await findFixtureFont("eng");
    expect(font).not.toBeNull();
    const pg = await renderTextPage(["Hello world"], { fontPath: font ?? "", dpi: 150 });
    expect(pg.width).toBe(1240);
    const sharp = (await import("sharp")) as unknown as { default: (b: Buffer) => { stats(): Promise<{ channels: { min: number }[] }> } };
    const st = await sharp.default(pg.png).stats();
    expect(st.channels[0]?.min).toBeLessThan(80);
  });
});
