/**
 * PDF input: page rasterisation + embedded text-layer extraction.
 *
 * Library choice (evaluated 2026-10): pdfjs-dist 4.x "legacy" build (Apache-2.0, Mozilla, actively
 * maintained, pure JS) rendering onto @napi-rs/canvas (MIT, prebuilt Skia binaries per platform, no
 * system libs). Alternatives rejected: mupdf WASM (AGPL - incompatible with a closed gov product),
 * node-canvas (needs cairo/pango system packages + node-gyp), pdf2pic/poppler (system binary).
 * pdfjs also gives the positioned text content we need for the born-digital fast path.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { OcrInputError } from "../errors.js";
import type { OcrBlock, OcrLine, OcrWord, PageResult } from "../types.js";
import { pdfEncryptInTrailer } from "./detect.js";

/**
 * Default cap on the pixel area of ONE rasterised PDF page (25 MP). A canvas costs 4 bytes/pixel, so the
 * cap bounds the RGBA canvas at ~100 MB (plus a similar PNG/sharp working set per page). A3 at 300 DPI is
 * ~17 MP, so every legitimate scan resolution fits; larger pages (huge MediaBox, or a hostile PDF that
 * declares a 14400x14400 pt page) are scaled DOWN and the downscale is reported on the page metadata.
 */
export const DEFAULT_MAX_PIXELS = 25_000_000;
/**
 * Default pdfjs `maxImageSize` (total pixels of one EMBEDDED image; pdfjs silently skips larger images,
 * which would yield a blank page). 40 MP keeps A4 scans up to 600 DPI (~35 MP) while bounding the decoded
 * bitmap (~160 MB RGBA) that a decompression-bomb image could otherwise force.
 */
export const DEFAULT_MAX_IMAGE_SIZE = 40_000_000;

const ENCRYPTED_MESSAGE =
  "Encrypted PDFs are not accepted; remove the password/encryption and re-upload. "
  + "(PDFs protected only by an owner/permissions password, which open without a password, are accepted.)";

export interface TextLayerConfig {
  /** Min non-space characters for a page text layer to be trusted. Default 40. */
  minChars: number;
  /** Min whitespace-separated tokens. Default 6. */
  minWords: number;
  /** Min share of "printable" chars (no controls / U+FFFD / private-use). Default 0.92. */
  minPrintableRatio: number;
  /** Master switch. Default true. */
  enabled: boolean;
}
export const DEFAULT_TEXT_LAYER: TextLayerConfig = { minChars: 40, minWords: 6, minPrintableRatio: 0.92, enabled: true };

export interface TextLayerAssessment { good: boolean; chars: number; words: number; printableRatio: number }

/** Heuristic: is this extracted text a usable text layer (vs empty / glyph-soup / scanned-with-junk)? */
export function assessTextLayer(text: string, cfg: TextLayerConfig = DEFAULT_TEXT_LAYER): TextLayerAssessment {
  let chars = 0;
  let printable = 0;
  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    chars++;
    const cp = ch.codePointAt(0) ?? 0;
    const bad = cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0xfffd || (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xfff0 && cp <= 0xffff);
    if (!bad) printable++;
  }
  const words = text.split(/\s+/u).filter(Boolean).length;
  const printableRatio = chars === 0 ? 0 : printable / chars;
  return { good: cfg.enabled && chars >= cfg.minChars && words >= cfg.minWords && printableRatio >= cfg.minPrintableRatio, chars, words, printableRatio };
}

export interface RenderedPdfPage {
  pageNumber: number;
  png: Buffer;
  width: number;
  height: number;
  dpi: number;
  /** Present only when the page has a good embedded text layer (OCR can be skipped). */
  textLayer: PageResult | null;
  /** DPI that was asked for (before any maxPixels downscale). */
  requestedDpi: number;
  /** True when the page was rendered below the requested DPI because it exceeded maxPixels. */
  downscaled: boolean;
}

interface PdfTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }
interface PdfViewport { width: number; height: number; convertToViewportPoint(x: number, y: number): [number, number] }
interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  getTextContent(): Promise<{ items: Array<PdfTextItem | { type: string }> }>;
  render(o: { canvasContext: unknown; viewport: PdfViewport }): { promise: Promise<void> };
  cleanup(): void;
}
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> }

const req = createRequire(import.meta.url);

export class PdfSource {
  private constructor(private readonly doc: PdfDoc, readonly pageCount: number) {}

  /**
   * Opens a PDF. Throws OcrInputError ENCRYPTED_PDF / CORRUPT. Encryption is decided by pdfjs itself
   * (PasswordException), not by a byte scan: a literal "/Encrypt" inside a stream or string must not reject a
   * normal PDF. Only when pdfjs cannot parse the file at all AND an /Encrypt entry sits in the trailer do we
   * report ENCRYPTED_PDF rather than CORRUPT.
   */
  static async open(data: Uint8Array, opts: { maxImageSize?: number } = {}): Promise<PdfSource> {    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
      getDocument(o: Record<string, unknown>): { promise: Promise<PdfDoc> };
    };
    const root = dirname(req.resolve("pdfjs-dist/package.json"));
    try {
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(data), // pdfjs detaches the buffer it is given
        standardFontDataUrl: join(root, "standard_fonts") + "/",
        cMapUrl: join(root, "cmaps") + "/",
        cMapPacked: true,
        isEvalSupported: false,
        maxImageSize: opts.maxImageSize ?? DEFAULT_MAX_IMAGE_SIZE,
        useSystemFonts: false,
        verbosity: 0,
      }).promise;
      return new PdfSource(doc, doc.numPages);
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? "";
      if (name === "PasswordException") throw new OcrInputError("ENCRYPTED_PDF", ENCRYPTED_MESSAGE);
      if (pdfEncryptInTrailer(data)) throw new OcrInputError("ENCRYPTED_PDF", ENCRYPTED_MESSAGE);
      throw new OcrInputError("CORRUPT", `PDF could not be parsed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async renderPage(pageNumber: number, opts: { dpi: number; maxPixels?: number; textLayer?: TextLayerConfig }): Promise<RenderedPdfPage> {
    const t0 = performance.now();
    let page: PdfPage;
    try {
      page = await this.doc.getPage(pageNumber);
    } catch (err) {
      throw new OcrInputError("CORRUPT", `PDF page ${pageNumber} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      let scale = opts.dpi / 72;
      let viewport = page.getViewport({ scale });
      const maxPx = Math.max(1, opts.maxPixels ?? DEFAULT_MAX_PIXELS);
      let downscaled = false;
      for (let guard = 0; guard < 4 && Math.ceil(viewport.width) * Math.ceil(viewport.height) > maxPx; guard++) {
        // shrink slightly more than the exact ratio so ceil() rounding cannot leave us a few pixels over the cap
        scale *= Math.sqrt(maxPx / (Math.ceil(viewport.width) * Math.ceil(viewport.height))) * 0.999;
        viewport = page.getViewport({ scale });
        downscaled = true;
      }
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));

      const tlCfg = opts.textLayer ?? DEFAULT_TEXT_LAYER;
      const content = await page.getTextContent();
      const layer = buildTextLayer(content.items, viewport);
      const assessment = assessTextLayer(layer.text, tlCfg);

      const { createCanvas } = await import("@napi-rs/canvas");
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      try {
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        throw new OcrInputError("CORRUPT", `PDF page ${pageNumber} could not be rendered: ${err instanceof Error ? err.message : String(err)}`);
      }
      const png = canvas.toBuffer("image/png");
      const effDpi = Math.round(scale * 72);
      const textLayer: PageResult | null = assessment.good
        ? {
            pageNumber,
            text: layer.text,
            blocks: layer.blocks,
            meanConfidence: 1,
            orientationDeg: 0,
            script: null,
            providerId: "pdf_text_layer",
            timings: { totalMs: Math.round(performance.now() - t0), recognizeMs: 0 },
            source: "pdf_text_layer",
          }
        : null;
      return { pageNumber, png, width, height, dpi: effDpi, textLayer, requestedDpi: opts.dpi, downscaled };
    } finally {
      page.cleanup();
    }
  }

  async close(): Promise<void> { await this.doc.destroy().catch(() => undefined); }
}

/** Converts pdfjs text items (PDF user space) into lines/words in raster pixel space. */
function buildTextLayer(items: ReadonlyArray<PdfTextItem | { type: string }>, vp: PdfViewport): { text: string; blocks: OcrBlock[] } {
  interface Run { str: string; x0: number; y0: number; x1: number; y1: number }
  const runs: Run[] = [];
  for (const it of items) {
    if (!("str" in it) || it.str.length === 0) continue;
    const [px, py] = vp.convertToViewportPoint(it.transform[4] ?? 0, it.transform[5] ?? 0);
    const [qx, qy] = vp.convertToViewportPoint((it.transform[4] ?? 0) + it.width, (it.transform[5] ?? 0) + (it.height || Math.abs(it.transform[3] ?? 0)));
    runs.push({ str: it.str, x0: Math.min(px, qx), x1: Math.max(px, qx), y0: Math.min(py, qy), y1: Math.max(py, qy) });
  }
  // group runs into lines by vertical proximity, keep stream order within a line
  const lines: Run[][] = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    const prev = last?.[last.length - 1];
    const h = Math.max(1, r.y1 - r.y0);
    if (last && prev && Math.abs(r.y1 - prev.y1) <= 0.5 * h) last.push(r);
    else lines.push([r]);
  }
  const ocrLines: OcrLine[] = [];
  for (const ln of lines) {
    let text = "";
    const words: OcrWord[] = [];
    let prev: Run | null = null;
    for (const r of ln) {
      const h = Math.max(1, r.y1 - r.y0);
      if (prev && !/\s$/u.test(text) && !/^\s/u.test(r.str) && r.x0 - prev.x1 > 0.15 * h) text += " ";
      text += r.str;
      const parts = r.str.split(/\s+/u).filter(Boolean);
      const totalChars = Math.max(1, parts.reduce((a, p) => a + p.length, 0));
      let cx = r.x0;
      for (const p of parts) {
        const w = ((r.x1 - r.x0) * p.length) / totalChars;
        words.push({ text: p, confidence: 1, bbox: { x0: Math.round(cx), y0: Math.round(r.y0), x1: Math.round(cx + w), y1: Math.round(r.y1) } });
        cx += w;
      }
      prev = r;
    }
    if (words.length === 0) continue;
    ocrLines.push({
      text: text.replace(/\s+/gu, " ").trim(),
      confidence: 1,
      bbox: {
        x0: Math.min(...words.map((w) => w.bbox.x0)), y0: Math.min(...words.map((w) => w.bbox.y0)),
        x1: Math.max(...words.map((w) => w.bbox.x1)), y1: Math.max(...words.map((w) => w.bbox.y1)),
      },
      words,
    });
  }
  const text = ocrLines.map((l) => l.text).join("\n");
  if (ocrLines.length === 0) return { text: "", blocks: [] };
  const block: OcrBlock = {
    text, confidence: 1, lines: ocrLines,
    bbox: {
      x0: Math.min(...ocrLines.map((l) => l.bbox.x0)), y0: Math.min(...ocrLines.map((l) => l.bbox.y0)),
      x1: Math.max(...ocrLines.map((l) => l.bbox.x1)), y1: Math.max(...ocrLines.map((l) => l.bbox.y1)),
    },
  };
  return { text, blocks: [block] };
}
