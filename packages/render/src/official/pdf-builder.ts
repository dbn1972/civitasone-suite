/**
 * OfficialPdf: the layout engine for every issued document (payslip, Form 12BA, sanction order,
 * purchase order, GRN, invoice, journal voucher, minutes, service book, note sheet).
 *
 * Built on pdf-lib (the engine the note sheet and the billing invoice already use) with fontkit
 * so the embedded font is Noto Sans Devanagari: real Unicode text in English, Hindi or both,
 * text that a PDF viewer can search and copy, A4 pages with a running footer. Pure and
 * deterministic: the same model and `generatedAt` produce the same document.
 */
import { PDFDocument, PDFName, PDFString, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { docFontBytes, DOC_FONT, type DocFontSubset, type DocFontWeight } from "./fonts.js";
import { formatDateTimeIst } from "./format.js";
import { parseMarkdown } from "./markdown.js";

interface CoverageFont { hasGlyphForCodePoint(cp: number): boolean }
interface FontkitModule { create(bytes: Uint8Array): CoverageFont }

let fontkitPromise: Promise<FontkitModule> | null = null;

/** @pdf-lib/fontkit (its Indic shaper needs the regenerator runtime as a global). */
async function loadFontkit(): Promise<FontkitModule> {
  if (!fontkitPromise) {
    fontkitPromise = (async () => {
      if (!(globalThis as { regeneratorRuntime?: unknown }).regeneratorRuntime) {
        const rr = "regenerator-runtime/runtime.js";
        await import(rr);
      }
      const name = "@pdf-lib/fontkit";
      const mod = (await import(name)) as { default?: FontkitModule } & FontkitModule;
      return mod.default ?? mod;
    })();
  }
  return fontkitPromise;
}

const coverageCache = new Map<string, CoverageFont>();
function coverageFont(fk: FontkitModule, subset: DocFontSubset, weight: DocFontWeight): CoverageFont {
  const key = `${subset}-${weight}`;
  let f = coverageCache.get(key);
  if (!f) {
    f = fk.create(docFontBytes(subset, weight));
    coverageCache.set(key, f);
  }
  return f;
}

interface Face { latin: PDFFont; deva: PDFFont; latinCov: CoverageFont; devaCov: CoverageFont }
interface Run { text: string; font: PDFFont }

const A4: [number, number] = [595.28, 841.89];
const MARGIN_X = 48;
const MARGIN_TOP = 44;
const MARGIN_BOTTOM = 58;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.38, 0.38, 0.38);
const RULE = rgb(0.55, 0.55, 0.55);
const SHADE = rgb(0.92, 0.92, 0.92);

function isDevanagari(cp: number): boolean {
  return (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff) || (cp >= 0x1cd0 && cp <= 0x1cff)
    || cp === 0x20b9 || cp === 0x200c || cp === 0x200d || cp === 0x25cc;
}

export type Align = "left" | "right" | "center";

/** Issuing authority printed at the top of a document. Blank fields are omitted, never invented. */
export interface DocIssuer {
  orgName?: string | null;
  orgNameHi?: string | null;
  ministry?: string | null;
  department?: string | null;
  address?: string | null;
}

export interface OfficialPdfOptions {
  /** Document title (PDF metadata). */
  title: string;
  /** Primary language for the PDF Lang entry. */
  lang?: "en" | "hi" | "bilingual";
  /** Left footer text on every page (document type and number). */
  footerNote?: string;
  /** Fixed timestamp for the "Generated on" footer (tests); defaults to now. */
  generatedAt?: Date;
  /** Diagonal watermark on every page (e.g. "UNSIGNED", "DRAFT"). */
  watermark?: string | null;
  subject?: string;
}

export interface TableColumn { header: string; width: number; align?: Align }
export interface TableSpec {
  columns: TableColumn[];
  rows: string[][];
  /** Bold rows after the body (totals). */
  footRows?: string[][];
  /** Printed in a single full-width row when `rows` is empty. */
  emptyText?: string;
  size?: number;
}

export interface SignatureBlock {
  /** Caption above the signature space ("Prepared by", "Sanctioning authority"). */
  caption?: string | null;
  name: string;
  designation?: string | null;
  /** Further lines under the designation (office, date). */
  extra?: Array<string | null | undefined>;
}

export interface FieldRow { label: string; value: string }

export class OfficialPdf {
  private page: PDFPage;
  private y: number;
  private readonly contentW = A4[0] - MARGIN_X * 2;

  private constructor(
    private readonly doc: PDFDocument,
    private readonly regular: Face,
    private readonly bold: Face,
    private readonly opts: OfficialPdfOptions,
  ) {
    this.page = doc.addPage(A4);
    this.y = A4[1] - MARGIN_TOP;
  }

  static async create(opts: OfficialPdfOptions): Promise<OfficialPdf> {
    const fk = await loadFontkit();
    const doc = await PDFDocument.create();
    doc.registerFontkit(fk as unknown as Parameters<PDFDocument["registerFontkit"]>[0]);
    const face = async (weight: DocFontWeight): Promise<Face> => ({
      latin: await doc.embedFont(docFontBytes("latin", weight), { subset: true }),
      deva: await doc.embedFont(docFontBytes("devanagari", weight), { subset: true }),
      latinCov: coverageFont(fk, "latin", weight),
      devaCov: coverageFont(fk, "devanagari", weight),
    });
    const regular = await face(400);
    const bold = await face(700);
    const at = opts.generatedAt ?? new Date();
    doc.setTitle(opts.title, { showInWindowTitleBar: true });
    if (opts.subject) doc.setSubject(opts.subject);
    doc.setCreator("CivitasOne");
    doc.setProducer(`CivitasOne official documents (pdf-lib, ${DOC_FONT.family})`);
    doc.setCreationDate(at);
    doc.setModificationDate(at);
    doc.catalog.set(PDFName.of("Lang"), PDFString.of(opts.lang === "hi" ? "hi-IN" : "en-IN"));
    return new OfficialPdf(doc, regular, bold, opts);
  }

  // ── text primitives ─────────────────────────────────────────────────────

  /** Split text into runs, each drawable with one embedded subset font. */
  private runs(text: string, bold: boolean): Run[] {
    const face = bold ? this.bold : this.regular;
    const out: Array<{ text: string; deva: boolean }> = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0x3f;
      let deva: boolean | null;
      let c = ch;
      if (cp === 0x20 || cp === 0xa0) {
        const prev = out[out.length - 1];
        deva = prev ? (prev.deva && face.devaCov.hasGlyphForCodePoint(0x20)) : false;
        c = " ";
      } else if (isDevanagari(cp)) {
        deva = face.devaCov.hasGlyphForCodePoint(cp) ? true : null;
      } else if (face.latinCov.hasGlyphForCodePoint(cp)) {
        deva = false;
      } else if (face.devaCov.hasGlyphForCodePoint(cp)) {
        deva = true;
      } else {
        deva = null;
      }
      if (deva === null) { c = "?"; deva = false; }
      const last = out[out.length - 1];
      if (last && last.deva === deva) last.text += c;
      else out.push({ text: c, deva });
    }
    return out.map((r) => ({ text: r.text, font: r.deva ? face.deva : face.latin }));
  }

  /** Width of `text` at `size` (sum of its runs). */
  width(text: string, size: number, bold = false): number {
    return this.runs(text, bold).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
  }

  private draw(text: string, x: number, y: number, size: number, bold = false, color: RGB = INK, page: PDFPage = this.page): void {
    let cx = x;
    for (const r of this.runs(text, bold)) {
      page.drawText(r.text, { x: cx, y, size, font: r.font, color });
      cx += r.font.widthOfTextAtSize(r.text, size);
    }
  }

  private drawAligned(text: string, left: number, w: number, y: number, size: number, align: Align, bold = false, color: RGB = INK): void {
    const tw = this.width(text, size, bold);
    const x = align === "right" ? left + w - tw : align === "center" ? left + (w - tw) / 2 : left;
    this.draw(text, x, y, size, bold, color);
  }

  /** Greedy word wrap; explicit newlines are kept; an over-long word is broken by characters. */
  wrap(text: string, size: number, maxW: number, bold = false): string[] {
    const lines: string[] = [];
    for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
      let line = "";
      for (const word of para.split(/ +/)) {
        const cand = line ? `${line} ${word}` : word;
        if (this.width(cand, size, bold) <= maxW) { line = cand; continue; }
        if (line) { lines.push(line); line = ""; }
        if (this.width(word, size, bold) <= maxW) { line = word; continue; }
        // a single word wider than the line: hard-break it by characters
        let chunk = "";
        for (const ch of [...word]) {
          if (chunk && this.width(chunk + ch, size, bold) > maxW) { lines.push(chunk); chunk = ch; } else chunk += ch;
        }
        line = chunk;
      }
      lines.push(line);
    }
    return lines;
  }

  private newPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN_TOP;
  }

  /** Start a new page unless `h` points still fit. */
  ensure(h: number): void {
    if (this.y - h < MARGIN_BOTTOM) this.newPage();
  }

  space(h: number): this { this.y -= h; return this; }

  rule(thickness = 0.8): this {
    this.ensure(6);
    this.page.drawLine({ start: { x: MARGIN_X, y: this.y }, end: { x: A4[0] - MARGIN_X, y: this.y }, thickness, color: RULE });
    this.y -= 8;
    return this;
  }

  // ── document blocks ─────────────────────────────────────────────────────

  /** Centred issuing-authority header. Nothing is printed for a blank field. */
  letterhead(issuer: DocIssuer): this {
    const lines: Array<{ text: string; size: number; bold: boolean }> = [];
    const push = (t: string | null | undefined, size: number, bold: boolean) => { if (t && t.trim()) lines.push({ text: t.trim(), size, bold }); };
    push(issuer.orgNameHi, 13, true);
    push(issuer.orgName, 13, true);
    push(issuer.ministry, 10.5, false);
    push(issuer.department, 10.5, false);
    push(issuer.address, 9, false);
    if (lines.length === 0) return this;
    for (const l of lines) {
      for (const w of this.wrap(l.text, l.size, this.contentW, l.bold)) {
        this.ensure(l.size + 4);
        this.drawAligned(w, MARGIN_X, this.contentW, this.y - l.size, l.size, "center", l.bold);
        this.y -= l.size + 4;
      }
    }
    this.y -= 2;
    return this.rule(1.2);
  }

  /** Centred document title; with a Hindi title the two are printed as "हिंदी / English". */
  title(en: string, hi?: string | null): this {
    this.space(4);
    const text = hi ? `${hi} / ${en}` : en;
    for (const w of this.wrap(text, 14, this.contentW, true)) {
      this.ensure(20);
      this.drawAligned(w, MARGIN_X, this.contentW, this.y - 14, 14, "center", true);
      this.y -= 19;
    }
    this.y -= 4;
    return this;
  }

  /** "No. ..." on the left and "Dated: ..." on the right, as on a Government order. */
  refLine(left: string, right: string): this {
    this.ensure(16);
    this.draw(left, MARGIN_X, this.y - 10, 10, true);
    this.drawAligned(right, MARGIN_X, this.contentW, this.y - 10, 10, "right", true);
    this.y -= 18;
    return this;
  }

  heading(text: string, size = 11): this {
    this.space(6);
    for (const w of this.wrap(text, size, this.contentW, true)) {
      this.ensure(size + 10);
      this.draw(w, MARGIN_X, this.y - size, size, true);
      this.y -= size + 5;
    }
    this.y -= 2;
    return this;
  }

  paragraph(text: string, o: { size?: number; bold?: boolean; indent?: number; align?: Align; muted?: boolean; prefix?: string; gapAfter?: number } = {}): this {
    const size = o.size ?? 10;
    const indent = o.indent ?? 0;
    const prefixW = o.prefix ? Math.max(this.width(o.prefix, size, o.bold) + 4, 16) : 0;
    const left = MARGIN_X + indent + prefixW;
    const w = this.contentW - indent - prefixW;
    const lines = this.wrap(text, size, w, o.bold);
    lines.forEach((l, i) => {
      this.ensure(size + 5);
      if (i === 0 && o.prefix) this.draw(o.prefix, MARGIN_X + indent, this.y - size, size, o.bold, o.muted ? MUTED : INK);
      this.drawAligned(l, left, w, this.y - size, size, o.align ?? "left", o.bold, o.muted ? MUTED : INK);
      this.y -= size + 4.5;
    });
    this.y -= o.gapAfter ?? 4;
    return this;
  }

  note(text: string): this {
    return this.paragraph(text, { size: 8, muted: true, gapAfter: 2 });
  }

  /** Label/value grid (two pairs per row by default). Blank values print as "—". */
  fields(rows: FieldRow[], columns: 1 | 2 = 2): this {
    const size = 9.5;
    const colW = this.contentW / columns;
    const labelW = Math.min(colW * 0.42, 140);
    for (let i = 0; i < rows.length; i += columns) {
      const slice = rows.slice(i, i + columns);
      const heights = slice.map((r) => Math.max(this.wrap(r.label, size, labelW - 6, true).length, this.wrap(r.value || "—", size, colW - labelW - 8).length));
      const h = Math.max(...heights) * (size + 3.5) + 3;
      this.ensure(h);
      slice.forEach((r, j) => {
        const x = MARGIN_X + j * colW;
        this.wrap(r.label, size, labelW - 6, true).forEach((l, k) => this.draw(l, x, this.y - size - k * (size + 3.5), size, true, MUTED));
        this.wrap(r.value || "—", size, colW - labelW - 8).forEach((l, k) => this.draw(l, x + labelW, this.y - size - k * (size + 3.5), size));
      });
      this.y -= h;
    }
    this.y -= 4;
    return this;
  }

  /** Bordered table; the header row repeats on every page the table spans. */
  table(spec: TableSpec): this {
    const size = spec.size ?? 9;
    const pad = 4;
    const lead = size + 3;
    const total = spec.columns.reduce((s, c) => s + c.width, 0);
    const widths = spec.columns.map((c) => (c.width / total) * this.contentW);
    const lefts = widths.map((_, i) => MARGIN_X + widths.slice(0, i).reduce((s, w) => s + w, 0));

    const rowHeight = (cells: string[], bold: boolean) =>
      Math.max(1, ...cells.map((c, i) => this.wrap(c ?? "", size, (widths[i] ?? 0) - pad * 2, bold).length)) * lead + pad * 2 - 2;

    const drawRow = (cells: string[], bold: boolean, shaded: boolean) => {
      const h = rowHeight(cells, bold);
      if (shaded) this.page.drawRectangle({ x: MARGIN_X, y: this.y - h, width: this.contentW, height: h, color: SHADE });
      cells.forEach((c, i) => {
        const w = widths[i] ?? 0;
        const x = lefts[i] ?? MARGIN_X;
        this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, borderColor: RULE, borderWidth: 0.5 });
        const align = spec.columns[i]?.align ?? "left";
        this.wrap(c ?? "", size, w - pad * 2, bold).forEach((l, k) =>
          this.drawAligned(l, x + pad, w - pad * 2, this.y - pad - size - k * lead + 1, size, align, bold));
      });
      this.y -= h;
    };

    const header = spec.columns.map((c) => c.header);
    const drawHeader = () => drawRow(header, true, true);
    this.ensure(rowHeight(header, true) + lead * 2);
    drawHeader();
    const body = spec.rows.length > 0 ? spec.rows : null;
    if (!body) {
      const h = lead + pad * 2;
      this.ensure(h);
      this.page.drawRectangle({ x: MARGIN_X, y: this.y - h, width: this.contentW, height: h, borderColor: RULE, borderWidth: 0.5 });
      this.draw(spec.emptyText ?? "—", MARGIN_X + pad, this.y - pad - size, size, false, MUTED);
      this.y -= h;
    } else {
      for (const r of body) {
        const h = rowHeight(r, false);
        if (this.y - h < MARGIN_BOTTOM) { this.newPage(); drawHeader(); }
        drawRow(r, false, false);
      }
    }
    for (const r of spec.footRows ?? []) {
      const h = rowHeight(r, true);
      if (this.y - h < MARGIN_BOTTOM) { this.newPage(); drawHeader(); }
      drawRow(r, true, true);
    }
    this.y -= 8;
    return this;
  }

  /** Officer-authored Markdown rendered as formatted text (headings, lists, tables). */
  markdown(md: string): this {
    for (const b of parseMarkdown(md)) {
      if (b.kind === "heading") this.heading(b.text, b.level === 1 ? 12 : b.level === 2 ? 11 : 10);
      else if (b.kind === "para") this.paragraph(b.text);
      else if (b.kind === "item") this.paragraph(b.text, { prefix: b.marker, indent: 8, gapAfter: 2 });
      else if (b.kind === "rule") this.rule(0.5);
      else if (b.kind === "table") {
        const [head, ...rest] = b.rows;
        const cols = (head ?? []).map((h) => ({ header: h, width: 1 }));
        if (cols.length > 0) this.table({ columns: cols, rows: rest.map((r) => cols.map((_, i) => r[i] ?? "")) });
      }
    }
    return this;
  }

  /**
   * Signature blocks: one block sits at the right (Government order style); several are
   * spread across the width (prepared / checked / approved).
   */
  signatures(blocks: SignatureBlock[]): this {
    if (blocks.length === 0) return this;
    const size = 9.5;
    const colW = blocks.length === 1 ? 230 : this.contentW / blocks.length;
    const lefts = blocks.map((_, i) => (blocks.length === 1 ? A4[0] - MARGIN_X - colW : MARGIN_X + i * colW));
    const linesOf = (b: SignatureBlock) => [
      ...(b.caption ? [{ t: b.caption, bold: true, muted: true }] : []),
      { t: "__SIGN__", bold: false, muted: false },
      { t: `(${b.name})`, bold: true, muted: false },
      ...(b.designation ? [{ t: b.designation, bold: false, muted: false }] : []),
      ...(b.extra ?? []).filter((e): e is string => !!e && !!e.trim()).map((e) => ({ t: e, bold: false, muted: true })),
    ];
    const heightOf = (b: SignatureBlock) => linesOf(b).reduce((h, l) => h + (l.t === "__SIGN__" ? 30 : this.wrap(l.t, size, colW - 8, l.bold).length * (size + 3.5)), 0);
    const h = Math.max(...blocks.map(heightOf));
    this.space(10);
    this.ensure(h + 4);
    const top = this.y;
    blocks.forEach((b, i) => {
      let y = top;
      for (const l of linesOf(b)) {
        if (l.t === "__SIGN__") { y -= 30; continue; }
        for (const w of this.wrap(l.t, size, colW - 8, l.bold)) {
          this.drawAligned(w, lefts[i] ?? MARGIN_X, colW, y - size, size, "center", l.bold, l.muted ? MUTED : INK);
          y -= size + 3.5;
        }
      }
    });
    this.y = top - h - 6;
    return this;
  }

  /** Serialise: running footer (note, page x of n, generated time in IST) and watermark. */
  async save(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    const generated = `Generated on ${formatDateTimeIst(this.opts.generatedAt ?? new Date())}`;
    pages.forEach((p, i) => {
      const y = 30;
      p.drawLine({ start: { x: MARGIN_X, y: y + 12 }, end: { x: A4[0] - MARGIN_X, y: y + 12 }, thickness: 0.5, color: RULE });
      const pageLabel = `Page ${i + 1} of ${pages.length}`;
      const pw = this.width(pageLabel, 8);
      if (this.opts.footerNote) {
        const note = this.wrap(this.opts.footerNote, 8, this.contentW - pw - 16)[0] ?? "";
        this.draw(note, MARGIN_X, y, 8, false, MUTED, p);
      }
      this.draw(pageLabel, A4[0] - MARGIN_X - pw, y, 8, false, MUTED, p);
      this.draw(generated, MARGIN_X, y - 11, 7.5, false, MUTED, p);
      if (this.opts.watermark) {
        const size = 44;
        const tw = this.width(this.opts.watermark, size, true);
        const rad = (35 * Math.PI) / 180;
        const x = A4[0] / 2 - (Math.cos(rad) * tw) / 2;
        const wy = A4[1] / 2 - (Math.sin(rad) * tw) / 2;
        let cx = 0;
        for (const r of this.runs(this.opts.watermark, true)) {
          p.drawText(r.text, { x: x + Math.cos(rad) * cx, y: wy + Math.sin(rad) * cx, size, font: r.font, color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(35) });
          cx += r.font.widthOfTextAtSize(r.text, size);
        }
      }
    });
    return this.doc.save();
  }
}
