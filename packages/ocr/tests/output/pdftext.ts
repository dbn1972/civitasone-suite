import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const req = createRequire(import.meta.url);

interface TextItem { str: string; transform: number[]; width: number }
interface Page { getTextContent(): Promise<{ items: Array<TextItem | { type: string }> }>; getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }> }
interface Doc { numPages: number; getPage(n: number): Promise<Page>; destroy(): Promise<void> }

export async function openPdf(data: Uint8Array): Promise<Doc> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as { getDocument(o: Record<string, unknown>): { promise: Promise<Doc> } };
  const root = dirname(req.resolve("pdfjs-dist/package.json"));
  return pdfjs.getDocument({
    data: new Uint8Array(data), standardFontDataUrl: join(root, "standard_fonts") + "/", cMapUrl: join(root, "cmaps") + "/",
    cMapPacked: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0,
  }).promise;
}

export interface ExtractedItem { str: string; x: number; y: number; width: number }

/** Text items per page as pdfjs sees them (this is what a PDF viewer's search/copy uses). */
export async function pdfTextItems(data: Uint8Array): Promise<ExtractedItem[][]> {
  const doc = await openPdf(data);
  const out: ExtractedItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    out.push(
      tc.items
        .filter((i): i is TextItem => "str" in i && i.str.trim() !== "")
        .map((i) => ({ str: i.str, x: i.transform[4] ?? 0, y: i.transform[5] ?? 0, width: i.width })),
    );
  }
  await doc.destroy();
  return out;
}

/** All decoded stream contents of the PDF concatenated (content streams are Flate-compressed on disk). */
export async function rawContent(pdf: Uint8Array): Promise<string> {
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(pdf);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try { out += Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1") + "\n"; } catch { /* binary/image stream */ }
    }
  }
  return out;
}
