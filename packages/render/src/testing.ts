/**
 * @civitasone/render/testing - inspect a generated PDF in tests with the repo PDF libraries:
 * pdfjs-dist (the text a viewer shows, searches and copies) and pdf-lib (font dictionaries,
 * page sizes). Test-only: never imported by service runtime code.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";

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
 * pdf.js text items per page as lines (reference only: pdf.js ignores /ActualText, so a
 * Devanagari cluster whose glyph has no ToUnicode entry, such as the reph in कार्यालय, comes back
 * as U+0000 here, while Acrobat, Chrome and pdfium copy it correctly from ActualText).
 */
export async function pdfjsPageLines(data: Uint8Array): Promise<string[][]> {
  const doc = await openPdf(data);
  const pages: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const items = tc.items.filter((i): i is TextItem => "str" in i && i.str.length > 0);
    pages.push(items.map((i) => i.str));
  }
  await doc.destroy();
  return pages;
}

// ── Logical text (what a viewer copies): content stream + ToUnicode + /ActualText ─────────

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "hex"; v: string } | { t: "str"; v: string } | { t: "op"; v: string } | { t: "arr"; v: Tok[] } | { t: "dict"; v: Map<string, Tok> };

function lex(src: string): Tok[] {
  let i = 0;
  const ws = () => { while (i < src.length && /[\s]/.test(src[i]!)) i++; };
  const one = (): Tok | null => {
    ws();
    if (i >= src.length) return null;
    const c = src[i]!;
    if (c === "%") { while (i < src.length && src[i] !== "\n") i++; return one(); }
    if (c === "/") { let j = i + 1; while (j < src.length && !/[\s\/\[\]<>()]/.test(src[j]!)) j++; const v = src.slice(i + 1, j); i = j; return { t: "name", v }; }
    if (c === "<" && src[i + 1] === "<") {
      i += 2; const m = new Map<string, Tok>();
      for (;;) { ws(); if (src[i] === ">" && src[i + 1] === ">") { i += 2; break; } const k = one(); const v = one(); if (!k || !v) break; if (k.t === "name") m.set(k.v, v); }
      return { t: "dict", v: m };
    }
    if (c === "<") { const j = src.indexOf(">", i); const v = src.slice(i + 1, j).replace(/\s+/g, ""); i = j + 1; return { t: "hex", v }; }
    if (c === "(") {
      let depth = 1, j = i + 1, out = "";
      while (j < src.length && depth > 0) { const ch = src[j]!; if (ch === "\\") { out += src[j + 1] ?? ""; j += 2; continue; } if (ch === "(") depth++; if (ch === ")") { depth--; if (depth === 0) break; } out += ch; j++; }
      i = j + 1; return { t: "str", v: out };
    }
    if (c === "[") { i++; const arr: Tok[] = []; for (;;) { ws(); if (src[i] === "]") { i++; break; } const x = one(); if (!x) break; arr.push(x); } return { t: "arr", v: arr }; }
    let j = i; while (j < src.length && !/[\s\/\[\]<>()%]/.test(src[j]!)) j++;
    if (j === i) { i++; return one(); }
    const w = src.slice(i, j); i = j;
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(w) ? { t: "num", v: Number(w) } : { t: "op", v: w };
  };
  const out: Tok[] = [];
  for (let x = one(); x; x = one()) out.push(x);
  return out;
}

function utf16be(hex: string): string {
  let h = hex;
  if (h.toUpperCase().startsWith("FEFF")) h = h.slice(4);
  const units: number[] = [];
  for (let k = 0; k + 3 < h.length; k += 4) units.push(parseInt(h.slice(k, k + 4), 16));
  return String.fromCharCode(...units);
}

function parseToUnicode(cmap: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of (block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) m.set(p[1]!.toUpperCase(), utf16be(p[2]!));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of (block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(p[1]!, 16), hi = parseInt(p[2]!, 16), base = parseInt(p[3]!, 16), w = p[1]!.length;
      for (let c = lo; c <= hi; c++) m.set(c.toString(16).toUpperCase().padStart(w, "0"), String.fromCharCode(base + (c - lo)));
    }
  }
  return m;
}

interface Placed { x: number; y: number; s: string; block: number; size: number }

/**
 * Text of each page as lines, read the way Acrobat / Chrome / pdfium copy it: glyph codes through
 * the font ToUnicode CMap, and a marked-content span with /ActualText replaced by its text (Chromium
 * writes one per Devanagari cluster, so reph, conjuncts and reordered i-matra come out in logical
 * order). Items are grouped by baseline and ordered left to right; separate text objects on one line
 * are joined with a space.
 */
export async function pdfPageLines(data: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const look = (v: unknown): unknown => (v instanceof PDFRef ? doc.context.lookup(v) : v);
  const streamText = (v: unknown): string => {
    const o = look(v);
    if (o instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(o).decode()).toString("latin1");
    if (o instanceof PDFArray) return o.asArray().map(streamText).join("\n");
    return "";
  };
  const pages: string[][] = [];
  for (const page of doc.getPages()) {
    const fonts = new Map<string, { map: Map<string, string>; width: number }>();
    const res = look(page.node.get(PDFName.of("Resources")));
    const fdict = res instanceof PDFDict ? look(res.get(PDFName.of("Font"))) : undefined;
    if (fdict instanceof PDFDict) {
      for (const [k, v] of fdict.entries()) {
        const f = look(v);
        if (!(f instanceof PDFDict)) continue;
        const tu = f.get(PDFName.of("ToUnicode"));
        const type0 = String(look(f.get(PDFName.of("Subtype")))) === "/Type0";
        fonts.set(k.toString().replace(/^\//, ""), { map: tu ? parseToUnicode(streamText(tu)) : new Map(), width: type0 ? 4 : 2 });
      }
    }
    const toks = lex(streamText(page.node.get(PDFName.of("Contents"))));
    const stack: Mat[] = [];
    let ctm: Mat = IDENT, tm: Mat = IDENT, lm: Mat = IDENT;
    let font: { map: Map<string, string>; width: number } | undefined;
    let fontSize = 10;
    let block = 0;
    let span: { text: string; placed: boolean } | null = null;
    const placed: Placed[] = [];
    const operands: Tok[] = [];
    const here = () => { const m = mul(tm, ctm); return { x: m[4], y: Math.round(m[5] * 2) / 2, size: Math.abs(fontSize * (m[0] || m[3] || 1)) }; };
    const decode = (hex: string) => {
      if (!font) return "";
      let out = "";
      for (let k = 0; k + font.width <= hex.length; k += font.width) out += font.map.get(hex.slice(k, k + font.width).toUpperCase()) ?? "";
      return out;
    };
    const show = (text: string) => {
      if (span) { if (!span.placed) { placed.push({ ...here(), s: span.text, block }); span.placed = true; } return; }
      if (text) placed.push({ ...here(), s: text, block });
    };
    for (const tk of toks) {
      if (tk.t !== "op") { operands.push(tk); continue; }
      const nums = operands.filter((o): o is { t: "num"; v: number } => o.t === "num").map((o) => o.v);
      switch (tk.v) {
        case "q": stack.push(ctm); break;
        case "Q": ctm = stack.pop() ?? IDENT; break;
        case "cm": if (nums.length >= 6) ctm = mul(nums.slice(-6) as Mat, ctm); break;
        case "BT": tm = IDENT; lm = IDENT; block++; break;
        case "Tf": { const n = operands.find((o) => o.t === "name"); if (n && n.t === "name") font = fonts.get(n.v); if (nums.length) fontSize = nums[nums.length - 1]!; break; }
        case "Tm": if (nums.length >= 6) { tm = nums.slice(-6) as Mat; lm = tm; } break;
        case "Td": case "TD": if (nums.length >= 2) { lm = mul([1, 0, 0, 1, nums[nums.length - 2]!, nums[nums.length - 1]!], lm); tm = lm; } break;
        case "Tj": case "\x27": { const h = operands.find((o) => o.t === "hex" || o.t === "str"); if (h) show(h.t === "hex" ? decode(h.v) : h.v); break; }
        case "TJ": { const a = operands.find((o) => o.t === "arr"); if (a && a.t === "arr") show(a.v.map((e) => (e.t === "hex" ? decode(e.v) : e.t === "str" ? e.v : "")).join("")); break; }
        case "BDC": {
          const props = operands.find((o) => o.t === "dict");
          const at = props && props.t === "dict" ? props.v.get("ActualText") : undefined;
          span = at ? { text: at.t === "hex" ? utf16be(at.v) : at.t === "str" ? at.v : "", placed: false } : null;
          break;
        }
        case "EMC": if (span && !span.placed && span.text) placed.push({ ...here(), s: span.text, block }); span = null; break;
        default: break;
      }
      operands.length = 0;
    }
    const lines = new Map<number, Placed[]>();
    for (const p of placed) {
      const key = [...lines.keys()].find((k) => Math.abs(k - p.y) <= 2) ?? p.y;
      lines.set(key, [...(lines.get(key) ?? []), p]);
    }
    // PDF user space: y grows upward, so the top line has the largest y.
    const topDown = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    pages.push(topDown.map(([, items]) => {
      items.sort((a, b) => a.x - b.x);
      let out = "", lastBlock = -1, lastX = -Infinity;
      for (const it of items) {
        // A new text object right after the previous glyph is the same word in another font
        // (Chromium splits runs by font subset: "(", "₹", ")"); a real gap is a word break.
        const gap = it.x - lastX;
        if (out && it.block !== lastBlock && !out.endsWith(" ") && !it.s.startsWith(" ") && gap > it.size * 1.1) out += " ";
        out += it.s; lastBlock = it.block; lastX = it.x;
      }
      return out.replace(/\s+/g, " ").trim();
    }).filter((l) => l.length > 0));
  }
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
