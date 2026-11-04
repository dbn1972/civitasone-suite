/**
 * @civitasone/render/testing - inspect a generated PDF in tests with the repo PDF libraries:
 * pdfjs-dist (the text a viewer shows, searches and copies) and pdf-lib (font dictionaries,
 * page sizes). Test-only: never imported by service runtime code.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";

const req = createRequire(import.meta.url);

interface TextItem { str: string; transform: number[]; width: number; hasEOL?: boolean }
interface PdfjsPage { getTextContent(): Promise<{ items: Array<TextItem | { type: string }> }> }
interface PdfjsDoc { numPages: number; getPage(n: number): Promise<PdfjsPage>; destroy(): Promise<void> }

async function openPdf(data: Uint8Array): Promise<PdfjsDoc> {
  const name = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = (await import(name)) as { getDocument(o: Record<string, unknown>): { promise: Promise<PdfjsDoc> } };
  const root = dirname(req.resolve("pdfjs-dist/package.json"));
  return pdfjs.getDocument({
    data: new Uint8Array(data), standardFontDataUrl: join(root, "standard_fonts") + "/", cMapUrl: join(root, "cmaps") + "/",
    cMapPacked: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0,
  }).promise;
}

/**
 * Text of each page as lines (items grouped by baseline, left to right; a visible gap between two
 * items becomes one space). Devanagari comes back in visual glyph order (as any viewer extracts it).
 */
export async function pdfPageLines(data: Uint8Array): Promise<string[][]> {
  const doc = await openPdf(data);
  const pages: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const items = tc.items
      .filter((i): i is TextItem => "str" in i && i.str.length > 0)
      .map((i) => ({ s: i.str, x: i.transform[4] ?? 0, y: Math.round((i.transform[5] ?? 0) * 2) / 2, w: i.width, size: Math.abs(i.transform[0] ?? 10) }));
    const byLine = new Map<number, typeof items>();
    for (const it of items) {
      const key = [...byLine.keys()].find((k) => Math.abs(k - it.y) <= 1.5) ?? it.y;
      byLine.set(key, [...(byLine.get(key) ?? []), it]);
    }
    const lines = [...byLine.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, its]) => {
        its.sort((a, b) => a.x - b.x);
        let out = "";
        let end = -Infinity;
        for (const it of its) {
          if (out && it.x - end > Math.max(1.2, it.size * 0.18) && !out.endsWith(" ") && !it.s.startsWith(" ")) out += " ";
          out += it.s;
          end = it.x + it.w;
        }
        return out.replace(/\s+/g, " ").trim();
      })
      .filter((l) => l.length > 0);
    pages.push(lines);
  }
  await doc.destroy();
  return pages;
}

/** All text of the document, one line per text line. */
export async function pdfText(data: Uint8Array): Promise<string> {
  return (await pdfPageLines(data)).map((p) => p.join("\n")).join("\n");
}

/** All text on one line (wrapped sentences read continuously), whitespace collapsed. */
export async function pdfFlatText(data: Uint8Array): Promise<string> {
  return (await pdfPageLines(data)).flat().join(" ").replace(/\s+/g, " ");
}

export interface PdfFontInfo { baseFont: string; subtype: string; embedded: boolean }

/** Every font the PDF references, and whether its program is embedded (FontFile / FontFile2 / FontFile3). */
export async function pdfFonts(data: Uint8Array): Promise<PdfFontInfo[]> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const out: PdfFontInfo[] = [];
  const lookup = (v: unknown): unknown => (v instanceof PDFRef ? doc.context.lookup(v) : v);
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (lookup(obj.get(PDFName.of("Type")))?.toString() !== "/Font") continue;
    const subtype = lookup(obj.get(PDFName.of("Subtype")))?.toString() ?? "";
    if (subtype === "/Type0") continue; // its descendant CIDFont carries the descriptor
    const baseFont = (lookup(obj.get(PDFName.of("BaseFont")))?.toString() ?? "").replace(/^\//, "");
    const desc = lookup(obj.get(PDFName.of("FontDescriptor")));
    const embedded = desc instanceof PDFDict && ["FontFile", "FontFile2", "FontFile3"].some((k) => {
      const f = lookup(desc.get(PDFName.of(k)));
      return f instanceof PDFRawStream || f instanceof PDFDict || (f !== undefined && f !== null);
    });
    out.push({ baseFont, subtype: subtype.replace(/^\//, ""), embedded });
  }
  return out;
}

/** Page count and the size of each page in points (A4 portrait is 595.28 x 841.89). */
export async function pdfPages(data: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  return doc.getPages().map((p) => p.getSize());
}

/** The %PDF- magic: a real PDF file, not an HTML page served from a /pdf URL. */
export function isPdf(data: Uint8Array | Buffer): boolean {
  const b = Buffer.from(data);
  return b.subarray(0, 5).toString("latin1") === "%PDF-";
}
