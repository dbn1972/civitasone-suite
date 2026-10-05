/**
 * Searchable PDF: original page image + invisible (text render mode 3) OCR text layer, word by word at the
 * word bbox. PII mask/redact findings are applied BEFORE the text layer is written (masked words are X-tokens).
 *
 * Fonts: Latin uses built-in Helvetica (no assets). Indic scripts need a Unicode TTF/OTF per script AND the
 * optional `@pdf-lib/fontkit` package; fonts are never bundled (no binaries committed). Supply them via
 * `opts.fontPaths` ({ Devanagari: "/path/NotoSansDevanagari-Regular.ttf" }) or a directory (opts.fontDir or env
 * OCR_PDF_FONT_DIR) whose file names contain the script name (e.g. NotoSansDevanagari-Regular.ttf).
 * Scripts with no usable font are dropped from the text layer and the page is reported in `degradedPages`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PDFDocument, PDFNumber, PDFOperator, PDFOperatorNames, StandardFonts, TextRenderingMode,
  popGraphicsState, pushGraphicsState, setTextRenderingMode,
  type PDFFont, type PDFImage,
} from "pdf-lib";
import type { PageImage, PageResult, PiiFinding } from "../types.js";
import { normaliseIndicDigits } from "../post/patterns.js";
import { maskPageResult } from "./mask.js";

export type ScriptName =
  | "Latin" | "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Odia" | "Tamil" | "Telugu" | "Kannada"
  | "Malayalam" | "Arabic";

export interface SearchablePdfOptions {
  pii?: readonly PiiFinding[];
  fontPaths?: Partial<Record<ScriptName, string>>;
  /** Directory scanned for fonts; defaults to env OCR_PDF_FONT_DIR. */
  fontDir?: string;
  /** DPI assumed when a PageImage reports 0. Default 300. */
  defaultDpi?: number;
  title?: string;
  /** Pre-loaded @pdf-lib/fontkit module (otherwise it is imported lazily if installed). */
  fontkit?: unknown;
}

export interface DegradedPage {
  pageNumber: number;
  reason: string;
  droppedScripts: ScriptName[];
  droppedChars: number;
}

export interface SearchablePdfResult {
  pdf: Uint8Array;
  pageCount: number;
  /** Pages that received a text layer (possibly degraded). */
  textLayerPages: number[];
  degradedPages: DegradedPage[];
  /** Script -> font file used (Latin => "Helvetica (built-in)"). */
  fontsUsed: Partial<Record<ScriptName, string>>;
}

export function scriptOfCodePoint(cp: number): ScriptName | null {
  if (cp >= 0x0900 && cp <= 0x0d7f && (cp & 0x7f) >= 0x66 && (cp & 0x7f) <= 0x6f) return null; // Indic digits are neutral
  if (cp >= 0x0900 && cp <= 0x097f) return "Devanagari";
  if (cp >= 0x0980 && cp <= 0x09ff) return "Bengali";
  if (cp >= 0x0a00 && cp <= 0x0a7f) return "Gurmukhi";
  if (cp >= 0x0a80 && cp <= 0x0aff) return "Gujarati";
  if (cp >= 0x0b00 && cp <= 0x0b7f) return "Odia";
  if (cp >= 0x0b80 && cp <= 0x0bff) return "Tamil";
  if (cp >= 0x0c00 && cp <= 0x0c7f) return "Telugu";
  if (cp >= 0x0c80 && cp <= 0x0cff) return "Kannada";
  if (cp >= 0x0d00 && cp <= 0x0d7f) return "Malayalam";
  if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return "Arabic";
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f)) return "Latin";
  return null; // digits, punctuation, ZWJ/ZWNJ ... follow the word's dominant script
}

/** Dominant script of a word (ties -> first letter's script); Latin when it has no letters. */
export function dominantScript(word: string): ScriptName {
  const counts = new Map<ScriptName, number>();
  for (const ch of word) {
    const s = scriptOfCodePoint(ch.codePointAt(0) ?? 0);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: ScriptName = "Latin";
  let bestN = 0;
  for (const [s, n] of counts) if (n > bestN) { best = s; bestN = n; }
  return best;
}

interface FontkitLike { create: unknown }
interface FkGlyph { id: number; advanceWidth: number; codePoints: number[] }
interface FkFont { glyphForCodePoint(cp: number): FkGlyph; layout: (t: string) => unknown }

/**
 * The text layer is INVISIBLE, so we do not need visual shaping - but fontkit's shaper reorders glyphs
 * (Devanagari reph/matra reordering) and pdf-lib's ToUnicode map then yields visually-ordered, WRONG text on
 * extraction ("कार्यालय" -> "कायार्लय"). This wrapper lays glyphs out one per code point in LOGICAL order so
 * copy/search returns exactly the OCR Unicode text.
 */
function logicalOrderFontkit(base: FontkitLike): FontkitLike {
  const create = (base as { create: (...a: unknown[]) => FkFont }).create.bind(base);
  return {
    create: (...args: unknown[]): FkFont => {
      const font = create(...args);
      font.layout = (text: string): unknown => {
        const glyphs = [...text].map((ch) => font.glyphForCodePoint(ch.codePointAt(0) ?? 0));
        return {
          glyphs,
          positions: glyphs.map((g) => ({ xAdvance: g.advanceWidth, yAdvance: 0, xOffset: 0, yOffset: 0 })),
        };
      };
      return font;
    },
  };
}
async function loadFontkit(): Promise<FontkitLike | null> {
  try {
    // fontkit's UMD build expects a global regeneratorRuntime (Indic shaping state machines).
    if (!(globalThis as { regeneratorRuntime?: unknown }).regeneratorRuntime) {
      try { const rr = "regenerator-runtime/runtime"; await import(/* @vite-ignore */ rr); } catch { /* optional */ }
    }
    const name = "@pdf-lib/fontkit";
    const mod = (await import(name)) as { default?: FontkitLike } & FontkitLike;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function discoverFonts(opts: SearchablePdfOptions): Promise<Partial<Record<ScriptName, string>>> {
  const found: Partial<Record<ScriptName, string>> = {};
  const dir = opts.fontDir ?? process.env["OCR_PDF_FONT_DIR"];
  if (dir) {
    let files: string[] = [];
    try { files = await readdir(dir); } catch { files = []; }
    const scripts: ScriptName[] = ["Latin", "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Odia", "Tamil", "Telugu", "Kannada", "Malayalam", "Arabic"];
    for (const f of files.sort()) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      for (const s of scripts) {
        if (!found[s] && f.toLowerCase().includes(s.toLowerCase())) found[s] = join(dir, f);
      }
    }
  }
  return { ...found, ...(opts.fontPaths ?? {}) };
}

async function imageToPdfImage(doc: PDFDocument, img: PageImage): Promise<PDFImage> {
  if (img.mimeType === "image/png") return doc.embedPng(img.data);
  if (img.mimeType === "image/jpeg") return doc.embedJpg(img.data);
  // TIFF (not natively embeddable): transcode to PNG with sharp, loaded lazily.
  const name = "sharp";
  const mod = (await import(name)) as { default?: (b: Uint8Array) => { png(): { toBuffer(): Promise<Buffer> } } };
  const sharp = mod.default ?? (mod as unknown as (b: Uint8Array) => { png(): { toBuffer(): Promise<Buffer> } });
  return doc.embedPng(await sharp(img.data).png().toBuffer());
}

export async function buildSearchablePdf(
  pageImages: readonly PageImage[],
  pageResults: readonly PageResult[],
  opts: SearchablePdfOptions = {},
): Promise<SearchablePdfResult> {
  const doc = await PDFDocument.create();
  doc.setProducer("CivitasOne @civitasone/ocr");
  if (opts.title) doc.setTitle(opts.title);
  const fontFiles = await discoverFonts(opts);
  const needsCustom = Object.keys(fontFiles).length > 0;
  const baseFontkit = needsCustom ? ((opts.fontkit as FontkitLike | undefined) ?? (await loadFontkit())) : null;
  const fontkit = baseFontkit ? logicalOrderFontkit(baseFontkit) : null;
  if (fontkit) doc.registerFontkit(fontkit as Parameters<PDFDocument["registerFontkit"]>[0]);

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const fonts = new Map<ScriptName, { font: PDFFont; chars: Set<number> }>();
  const fontsUsed: Partial<Record<ScriptName, string>> = {};
  const fontErrors = new Map<ScriptName, string>();
  const getFont = async (s: ScriptName): Promise<{ font: PDFFont; chars: Set<number> } | null> => {
    const cached = fonts.get(s);
    if (cached) return cached;
    if (s === "Latin" && !fontFiles.Latin) {
      const entry = { font: helv, chars: new Set(helv.getCharacterSet()) };
      fonts.set(s, entry);
      fontsUsed.Latin = "Helvetica (built-in)";
      return entry;
    }
    const path = fontFiles[s];
    if (!path) { fontErrors.set(s, `no font configured for ${s}`); return null; }
    if (!fontkit) { fontErrors.set(s, "@pdf-lib/fontkit is not installed"); return null; }
    try {
      const font = await doc.embedFont(await readFile(path), { subset: true });
      const entry = { font, chars: new Set(font.getCharacterSet()) };
      fonts.set(s, entry);
      fontsUsed[s] = path;
      return entry;
    } catch (e) {
      fontErrors.set(s, `font load failed for ${s}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const byNumber = new Map(pageResults.map((p) => [p.pageNumber, p]));
  const textLayerPages: number[] = [];
  const degradedPages: DegradedPage[] = [];

  for (const img of pageImages) {
    const dpi = img.dpi > 0 ? img.dpi : (opts.defaultDpi ?? 300);
    const scale = 72 / dpi;
    const wPt = img.width * scale;
    const hPt = img.height * scale;
    const page = doc.addPage([wPt, hPt]);
    page.drawImage(await imageToPdfImage(doc, img), { x: 0, y: 0, width: wPt, height: hPt });
    const raw = byNumber.get(img.pageNumber);
    if (!raw) continue;
    const result = opts.pii ? maskPageResult(raw, opts.pii) : raw;
    textLayerPages.push(img.pageNumber);
    const dropped = new Set<ScriptName>();
    const reasons = new Set<string>();
    let droppedChars = 0;

    for (const block of result.blocks) for (const line of block.lines) for (const word of line.words) {
      // Digit-only words (any script) are written as ASCII digits so they stay searchable without a font.
      const digitsOnly = /^[\p{Nd}\s.,:/-]+$/u.test(word.text);
      const wordText = digitsOnly ? normaliseIndicDigits(word.text) : word.text;
      const script = digitsOnly ? "Latin" : dominantScript(wordText);
      const entry = await getFont(script);
      if (!entry) {
        dropped.add(script);
        droppedChars += [...wordText].length;
        reasons.add(fontErrors.get(script) ?? `no font for ${script}`);
        continue;
      }
      let text = "";
      for (const ch of wordText.normalize("NFC")) {
        if (entry.chars.has(ch.codePointAt(0) ?? -1)) text += ch;
        else droppedChars++;
      }
      if (text.length === 0) continue;
      // RTL: PDF text is conventionally stored in VISUAL order and readers re-apply bidi on extraction.
      if (script === "Arabic") text = [...text].reverse().join("");
      if (text.length < [...wordText.normalize("NFC")].length) {
        dropped.add(script);
        reasons.add(`some ${script} characters not covered by font`);
      }
      const boxW = Math.max(0.5, (word.bbox.x1 - word.bbox.x0) * scale);
      const boxH = Math.max(1, (word.bbox.y1 - word.bbox.y0) * scale);
      const size = Math.min(200, Math.max(2, boxH * 0.85));
      const natural = entry.font.widthOfTextAtSize(text, size);
      const pct = natural > 0 ? Math.min(500, Math.max(10, (boxW / natural) * 100)) : 100;
      page.pushOperators(
        pushGraphicsState(),
        setTextRenderingMode(TextRenderingMode.Invisible),
        PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(pct)]),
      );
      page.drawText(text, { x: word.bbox.x0 * scale, y: hPt - word.bbox.y1 * scale + boxH * 0.2, size, font: entry.font });
      page.pushOperators(popGraphicsState());
    }
    if (dropped.size > 0) {
      degradedPages.push({ pageNumber: img.pageNumber, reason: [...reasons].join("; "), droppedScripts: [...dropped], droppedChars });
    }
  }
  const pdf = await doc.save({ useObjectStreams: false });
  return { pdf, pageCount: pageImages.length, textLayerPages, degradedPages, fontsUsed };
}
