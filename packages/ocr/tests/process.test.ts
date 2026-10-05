import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { OcrChain } from "../src/chain.js";
import { OcrInputError } from "../src/errors.js";
import { assessTextLayer, detectInputKind, pdfLooksEncrypted } from "../src/preprocess/index.js";
import { processDocument } from "../src/process.js";
import { fakeProvider, pageResult, syntheticTextPng } from "./helpers.js";

const LONG = "The Director General hereby sanctions the purchase of office furniture for the regional centre";

async function textPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const p = doc.addPage([595, 842]);
    lines.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 24, size: 12, font }));
  }
  return doc.save();
}

async function scannedPdf(nPages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(await syntheticTextPng({ width: 600, height: 800 }));
  for (let i = 0; i < nPages; i++) {
    const p = doc.addPage([300, 400]);
    p.drawImage(png, { x: 0, y: 0, width: 300, height: 400 });
  }
  return doc.save();
}

function chainWith(provider = fakeProvider("tesseract", (_c, ps) => ps.map((p) => pageResult(p, 0.9, "tesseract", `ocr page ${p.pageNumber}`)))) {
  return { provider, chain: new OcrChain({ providers: [{ provider }], langs: ["eng"] }) };
}
const NO_ORIENT = { orientationDetector: null } as const;

describe("magic-byte detection", () => {
  const b = (...n: number[]) => new Uint8Array([...n, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("identifies PNG / JPEG / TIFF / PDF from content", async () => {
    expect(detectInputKind(await syntheticTextPng({ width: 20, height: 20 }))).toBe("png");
    expect(detectInputKind(b(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(detectInputKind(b(0x49, 0x49, 0x2a, 0x00))).toBe("tiff");
    expect(detectInputKind(b(0x4d, 0x4d, 0x00, 0x2a))).toBe("tiff");
    expect(detectInputKind(Buffer.from("junk\n%PDF-1.7\n"))).toBe("pdf");
  });

  it("rejects SVG, executables and scripts as UNSUPPORTED_TYPE regardless of claimed MIME", async () => {
    const { provider, chain } = chainWith();
    const svg = Buffer.from("<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>");
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]);
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]);
    for (const data of [svg, exe, elf]) {
      const err = await processDocument({ data, mimeType: "image/png" }, { chain, ...NO_ORIENT }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OcrInputError);
      expect((err as OcrInputError).code).toBe("UNSUPPORTED_TYPE");
    }
    expect(provider.calls).toHaveLength(0);
  });

  it("reports empty/truncated input as CORRUPT", async () => {
    const { chain } = chainWith();
    const err = await processDocument({ data: new Uint8Array(3) }, { chain }).catch((e: unknown) => e);
    expect((err as OcrInputError).code).toBe("CORRUPT");
  });
});

describe("PDF input errors", () => {
  it("rejects encrypted PDFs with ENCRYPTED_PDF", async () => {
    const enc = Buffer.from("%PDF-1.6\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R/Encrypt 5 0 R/Size 6>>\nstartxref\n0\n%%EOF");
    expect(pdfLooksEncrypted(enc)).toBe(true);
    const { chain } = chainWith();
    const err = await processDocument({ data: enc, mimeType: "application/pdf" }, { chain, ...NO_ORIENT }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrInputError);
    expect((err as OcrInputError).code).toBe("ENCRYPTED_PDF");
  });

  it("rejects garbage PDFs with CORRUPT", async () => {
    const { chain } = chainWith();
    const err = await processDocument({ data: Buffer.from("%PDF-1.4\nthis is not a pdf at all") }, { chain, ...NO_ORIENT }).catch((e: unknown) => e);
    expect((err as OcrInputError).code).toBe("CORRUPT");
  });

  it("enforces the page cap with TOO_MANY_PAGES before any OCR", async () => {
    const { provider, chain } = chainWith();
    const err = await processDocument({ data: await scannedPdf(3) }, { chain, maxPages: 2, ...NO_ORIENT }).catch((e: unknown) => e);
    expect((err as OcrInputError).code).toBe("TOO_MANY_PAGES");
    expect(provider.calls).toHaveLength(0);
  });
});

describe("born-digital PDFs", () => {
  it("uses the embedded text layer and skips OCR entirely", async () => {
    const { provider, chain } = chainWith();
    const out = await processDocument({ data: await textPdf([[LONG, "Second line of the order issued in 2026"]]), mimeType: "application/pdf" }, { chain, ...NO_ORIENT });
    expect(provider.calls).toHaveLength(0);
    const page = out.result.pages[0];
    expect(page?.source).toBe("pdf_text_layer");
    expect(page?.providerId).toBe("pdf_text_layer");
    expect(page?.meanConfidence).toBe(1);
    expect(out.result.text).toContain("Director General hereby sanctions");
    expect(out.result.providerIds).toEqual(["pdf_text_layer"]);
    expect(out.reports).toEqual([null]);
    // page image still produced (needed for review viewer / searchable PDF) at the default 300 dpi
    expect(out.pages[0]?.dpi).toBe(300);
    expect(out.pages[0]?.width).toBe(Math.ceil(595 * 300 / 72));
    const w = page?.blocks[0]?.lines[0]?.words[0];
    expect(w).toBeDefined();
    expect(w!.bbox.x0).toBeGreaterThan(150); // 50pt * 300/72 ~ 208
    expect(w!.bbox.y0).toBeLessThan(w!.bbox.y1);
    expect(w!.bbox.y1).toBeLessThan(out.pages[0]!.height / 4); // first line near the top of the raster
  }, 60_000);

  it("OCRs only the pages whose text layer is missing/poor (mixed document)", async () => {
    const digital = await PDFDocument.load(await textPdf([[LONG, "another sentence to pad this page out nicely"]]));
    const scanned = await PDFDocument.load(await scannedPdf(1));
    const merged = await PDFDocument.create();
    for (const src of [digital, scanned]) for (const p of await merged.copyPages(src, [0])) merged.addPage(p);
    const { provider, chain } = chainWith();
    const out = await processDocument({ data: await merged.save() }, { chain, preprocess: { autoOrient: false }, ...NO_ORIENT });
    expect(provider.calls.map((c) => c.pages)).toEqual([[2]]);
    expect(out.result.pages.map((p) => [p.pageNumber, p.source])).toEqual([[1, "pdf_text_layer"], [2, "ocr"]]);
    expect(out.reports[0]).toBeNull();
    expect(out.reports[1]?.binarised).toBe(true);
  }, 60_000);

  it("treats a sparse/junk text layer as not good", () => {
    expect(assessTextLayer("page 1").good).toBe(false);
    expect(assessTextLayer("��� ".repeat(40)).good).toBe(false);
    expect(assessTextLayer(LONG).good).toBe(true);
    expect(assessTextLayer(LONG, { enabled: false, minChars: 1, minWords: 1, minPrintableRatio: 0 }).good).toBe(false);
  });

  it("can be disabled so everything is OCRed", async () => {
    const { provider, chain } = chainWith();
    await processDocument({ data: await textPdf([[LONG]]) }, { chain, textLayer: { enabled: false }, preprocess: { autoOrient: false }, ...NO_ORIENT });
    expect(provider.calls).toHaveLength(1);
  }, 60_000);
});

describe("image inputs", () => {
  it("processes PNG and JPEG through preprocessing and the chain", async () => {
    const png = await syntheticTextPng({ width: 600, height: 400, margin: 60 });
    const jpg = await sharp(png).jpeg().toBuffer();
    for (const [data, kind] of [[png, "png"], [jpg, "jpeg"]] as const) {
      const { provider, chain } = chainWith();
      const out = await processDocument({ data, mimeType: "application/octet-stream" }, { chain, ...NO_ORIENT });
      expect(out.kind).toBe(kind);
      expect(out.result.pageCount).toBe(1);
      expect(out.pages[0]?.mimeType).toBe("image/png");
      expect(out.pages[0]!.width).toBeLessThan(600); // cropped
      expect(provider.calls[0]?.pages).toEqual([1]);
      expect(out.result.pages[0]?.source).toBe("ocr");
    }
  });

  it("handles multipage TIFF page by page", async () => {
    const one = await sharp(await syntheticTextPng({ width: 300, height: 200 })).greyscale().raw().toBuffer();
    const tall = Buffer.concat([one, one, one]);
    const tiff = await sharp(tall, { raw: { width: 300, height: 600, channels: 1, pageHeight: 200 } }).tiff().toBuffer();
    expect((await sharp(tiff).metadata()).pages).toBe(3);
    const { provider, chain } = chainWith();
    const out = await processDocument({ data: tiff }, { chain, ...NO_ORIENT });
    expect(out.kind).toBe("tiff");
    expect(out.result.pageCount).toBe(3);
    expect(provider.calls.map((c) => c.pages).sort()).toEqual([[1], [2], [3]]); // one page per chain call (bounded memory)
    await expect(processDocument({ data: tiff }, { chain, maxPages: 2, ...NO_ORIENT })).rejects.toMatchObject({ code: "TOO_MANY_PAGES" });
  });

  it("records orientation on OCR pages when the detector gave a verdict", async () => {
    const png = await syntheticTextPng({ width: 600, height: 400 });
    const { chain } = chainWith();
    const detector = { detect: async () => ({ degrees: 180 as const, confidence: 5, script: "Latin" }), dispose: async () => undefined };
    const out = await processDocument({ data: png }, { chain, orientationDetector: detector, preprocess: { cropBorder: false } });
    expect(out.result.pages[0]?.orientationDeg).toBe(180);
  });
});
