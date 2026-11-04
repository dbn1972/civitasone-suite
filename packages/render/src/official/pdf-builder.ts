/**
 * OfficialPdf: the layout engine for every issued document (payslip, Form 12BA, sanction order,
 * purchase order, GRN, invoice, journal voucher, minutes, service book, note sheet).
 *
 * UAT ux-docs review (PR #2463): the document is built as HTML + CSS with the self-hosted
 * Noto Sans Devanagari inlined, and printed to PDF by Chromium through the same renderPdf path
 * Form 16 uses. Chromium shapes Devanagari with HarfBuzz (GSUB and GPOS, so matras, halant,
 * nukta and anusvara sit where the font puts them), embeds subset fonts, and writes a text
 * layer in logical order (copy and search return "कार्यालय", not the glyph order). The
 * earlier pdf-lib text drawing dropped GPOS offsets and is gone.
 */
import { renderPdf } from "../pdf.js";
import { DOC_FONT, DOC_FONT_STACK, docFontBytes, docFontFaceCss, docFontUnicodeRange } from "./fonts.js";
import { formatDateTimeIst } from "./format.js";
import { parseMarkdown } from "./markdown.js";

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
  /** Primary language (html lang). */
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
  /** Printed as "(Name)". Null leaves the name line blank, for a hand-written name. */
  name: string | null;
  designation?: string | null;
  /** Further lines under the designation (office, date). */
  extra?: Array<string | null | undefined>;
}

export interface FieldRow { label: string; value: string }

/** Chromium could not be started: no issuable PDF can be produced (callers answer 503). */
export class PdfRendererUnavailableError extends Error {
  readonly code = "PDF_RENDERER_UNAVAILABLE";
  constructor() {
    super("PDF rendering engine (Chromium) is unavailable");
    this.name = "PdfRendererUnavailableError";
  }
}

/** HTML-escape text; newlines become line breaks. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r?\n/g, "<br/>");
}

const CSS = `
@page { size: A4; margin: 16mm 14mm 20mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ${DOC_FONT_STACK}; font-size: 10pt; line-height: 1.38; color: #141414; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.lh { text-align: center; margin-bottom: 4pt; }
.lh .o { font-weight: 700; font-size: 13pt; }
.lh .m { font-size: 10.5pt; }
.lh .a { font-size: 9pt; }
hr.rule { border: 0; border-top: 1.2pt solid #8c8c8c; margin: 4pt 0 8pt; }
hr.thin { border: 0; border-top: 0.5pt solid #8c8c8c; margin: 4pt 0 6pt; }
h1.title { text-align: center; font-size: 14pt; font-weight: 700; margin: 6pt 0 8pt; }
.ref { display: flex; justify-content: space-between; font-weight: 700; margin: 2pt 0 8pt; }
h2 { font-size: 11pt; font-weight: 700; margin: 10pt 0 4pt; break-after: avoid; }
h2.s10 { font-size: 10pt; }
p { margin: 0 0 4pt; }
p.b { font-weight: 700; }
p.muted, .muted { color: #606060; }
p.note { font-size: 8pt; color: #606060; margin-bottom: 2pt; }
p.c { text-align: center; } p.r { text-align: right; }
.item { display: flex; gap: 4pt; margin: 0 0 3pt; }
.item .pfx { min-width: 18pt; flex: none; }
.fields { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); column-gap: 14pt; row-gap: 2pt; margin: 0 0 8pt; font-size: 9.5pt; }
.f { display: flex; gap: 6pt; break-inside: avoid; }
.f .l { flex: 0 0 38%; font-weight: 700; color: #606060; }
.fields.one .f .l { flex-basis: 34%; }
.f .v { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; margin: 2pt 0 8pt; table-layout: fixed; }
th, td { border: 0.5pt solid #8c8c8c; padding: 3pt 4pt; vertical-align: top; overflow-wrap: anywhere; }
thead { display: table-header-group; }
thead th { background: #ebebeb; font-weight: 700; text-align: left; }
tfoot td, tr.foot td { background: #ebebeb; font-weight: 700; }
tr { break-inside: avoid; }
.al-right { text-align: right !important; } .al-center { text-align: center !important; }
td.empty { color: #606060; }
.sigs { display: flex; justify-content: space-between; gap: 12pt; margin-top: 16pt; break-inside: avoid; }
.sig { flex: 1 1 0; text-align: center; font-size: 9.5pt; }
.sigs.single .sig { flex: 0 0 230pt; margin-left: auto; }
.sig .space { height: 30pt; }
.sig .cap { font-weight: 700; color: #606060; }
.sig .nm { font-weight: 700; }
.sig .blank { display: inline-block; min-width: 150pt; border-bottom: 0.6pt solid #606060; height: 11pt; }
.keep { break-inside: avoid; }
.wm { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 44pt; font-weight: 700; color: rgba(217, 51, 51, 0.16); white-space: nowrap; z-index: 0; pointer-events: none; }
`;

let footerFontCss: string | null = null;
/** The Latin subset only, for the running footer (rendered by Chromium in its own document). */
function footerFont(): string {
  if (!footerFontCss) {
    const range = docFontUnicodeRange("latin", 400);
    const b64 = Buffer.from(docFontBytes("latin", 400)).toString("base64");
    footerFontCss = `@font-face{font-family:"${DOC_FONT.family}";font-weight:400;src:url(data:font/woff;base64,${b64}) format("woff");${range ? `unicode-range:${range};` : ""}}`;
  }
  return footerFontCss;
}

export class OfficialPdf {
  private readonly parts: string[] = [];

  private constructor(private readonly opts: OfficialPdfOptions) {}

  static async create(opts: OfficialPdfOptions): Promise<OfficialPdf> {
    return new OfficialPdf(opts);
  }

  private push(html: string): this { this.parts.push(html); return this; }

  space(h: number): this { return this.push(`<div style="height:${Math.max(0, h)}pt"></div>`); }

  rule(thickness = 0.8): this { return this.push(`<hr class="${thickness >= 1 ? "rule" : "thin"}"/>`); }

  /** Centred issuing-authority header. Nothing is printed for a blank field. */
  letterhead(issuer: DocIssuer): this {
    const lines: string[] = [];
    const add = (t: string | null | undefined, cls: string) => { if (t && t.trim()) lines.push(`<div class="${cls}">${esc(t.trim())}</div>`); };
    add(issuer.orgNameHi, "o");
    add(issuer.orgName, "o");
    add(issuer.ministry, "m");
    add(issuer.department, "m");
    add(issuer.address, "a");
    if (lines.length === 0) return this;
    this.push(`<div class="lh">${lines.join("")}</div>`);
    return this.rule(1.2);
  }

  /** Centred document title; with a Hindi title the two are printed as "हिंदी / English". */
  title(en: string, hi?: string | null): this {
    return this.push(`<h1 class="title">${esc(hi ? `${hi} / ${en}` : en)}</h1>`);
  }

  /** "No. ..." on the left and "Dated: ..." on the right, as on a Government order. */
  refLine(left: string, right: string): this {
    return this.push(`<div class="ref"><span>${esc(left)}</span><span>${esc(right)}</span></div>`);
  }

  heading(text: string, size = 11): this {
    return this.push(`<h2${size <= 10 ? " class=\"s10\"" : ""}${size >= 12 ? " style=\"font-size:12pt\"" : ""}>${esc(text)}</h2>`);
  }

  paragraph(text: string, o: { size?: number; bold?: boolean; indent?: number; align?: Align; muted?: boolean; prefix?: string; gapAfter?: number } = {}): this {
    const style: string[] = [];
    if (o.size) style.push(`font-size:${o.size}pt`);
    if (o.indent) style.push(`margin-left:${o.indent}pt`);
    if (o.gapAfter !== undefined) style.push(`margin-bottom:${o.gapAfter}pt`);
    const cls = [o.bold ? "b" : "", o.muted ? "muted" : "", o.align === "center" ? "c" : o.align === "right" ? "r" : ""].filter(Boolean).join(" ");
    const st = style.length ? ` style="${style.join(";")}"` : "";
    if (o.prefix) {
      return this.push(`<div class="item${cls ? ` ${cls}` : ""}"${st}><span class="pfx">${esc(o.prefix)}</span><span>${esc(text)}</span></div>`);
    }
    return this.push(`<p${cls ? ` class="${cls}"` : ""}${st}>${esc(text)}</p>`);
  }

  note(text: string): this {
    return this.push(`<p class="note">${esc(text)}</p>`);
  }

  /** Label/value grid (two pairs per row by default). Blank values print as "—". */
  fields(rows: FieldRow[], columns: 1 | 2 = 2): this {
    const cells = rows.map((r) => `<div class="f"><span class="l">${esc(r.label)}</span><span class="v">${esc(r.value || "—")}</span></div>`).join("");
    return this.push(`<div class="fields${columns === 1 ? " one" : ""}" style="--cols:${columns}">${cells}</div>`);
  }

  /** Bordered table; the header row repeats on every page the table spans. */
  table(spec: TableSpec): this {
    const total = spec.columns.reduce((s, c) => s + c.width, 0) || 1;
    const al = (i: number) => {
      const a = spec.columns[i]?.align;
      return a === "right" ? " class=\"al-right\"" : a === "center" ? " class=\"al-center\"" : "";
    };
    const cols = spec.columns.map((c) => `<col style="width:${((c.width / total) * 100).toFixed(2)}%"/>`).join("");
    const head = `<thead><tr>${spec.columns.map((c, i) => `<th${al(i)}>${esc(c.header)}</th>`).join("")}</tr></thead>`;
    const row = (r: string[], foot = false) => `<tr${foot ? " class=\"foot\"" : ""}>${spec.columns.map((_, i) => `<td${al(i)}>${esc(r[i] ?? "")}</td>`).join("")}</tr>`;
    const body = spec.rows.length > 0
      ? spec.rows.map((r) => row(r)).join("")
      : `<tr><td class="empty" colspan="${spec.columns.length}">${esc(spec.emptyText ?? "—")}</td></tr>`;
    const foot = (spec.footRows ?? []).map((r) => row(r, true)).join("");
    const size = spec.size ? ` style="font-size:${spec.size}pt"` : " style=\"font-size:9pt\"";
    return this.push(`<table${size}><colgroup>${cols}</colgroup>${head}<tbody>${body}${foot}</tbody></table>`);
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
   * spread across the width (prepared / checked / approved). Kept together on one page.
   */
  signatures(blocks: SignatureBlock[]): this {
    if (blocks.length === 0) return this;
    const one = (b: SignatureBlock) => [
      b.caption ? `<div class="cap">${esc(b.caption)}</div>` : "",
      `<div class="space"></div>`,
      b.name ? `<div class="nm">(${esc(b.name)})</div>` : `<div><span class="blank"></span></div>`,
      b.designation ? `<div>${esc(b.designation)}</div>` : "",
      ...(b.extra ?? []).filter((e): e is string => !!e && !!e.trim()).map((e) => `<div class="muted">${esc(e)}</div>`),
    ].join("");
    return this.push(`<div class="sigs${blocks.length === 1 ? " single" : ""}">${blocks.map((b) => `<div class="sig">${one(b)}</div>`).join("")}</div>`);
  }

  /** The complete HTML document (also what the PDF is printed from). */
  toHtml(): string {
    const lang = this.opts.lang === "hi" ? "hi-IN" : "en-IN";
    const wm = this.opts.watermark ? `<div class="wm" aria-hidden="true">${esc(this.opts.watermark)}</div>` : "";
    return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"/><title>${esc(this.opts.title)}</title>`
      + `${this.opts.subject ? `<meta name="description" content="${esc(this.opts.subject)}"/>` : ""}`
      + `<style>${docFontFaceCss()}${CSS}</style></head><body>${wm}${this.parts.join("\n")}</body></html>`;
  }

  private footerTemplate(): string {
    const generated = `Generated on ${formatDateTimeIst(this.opts.generatedAt ?? new Date())}`;
    const note = this.opts.footerNote ? esc(this.opts.footerNote) : "";
    return `<style>${footerFont()}</style><div style="font-family:${DOC_FONT_STACK.replace(/"/g, "'")};font-size:7.5pt;color:#606060;width:100%;margin:0 14mm;border-top:0.5pt solid #8c8c8c;padding-top:2pt;">`
      + `<div style="display:flex;justify-content:space-between"><span>${note}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
      + `<div>${esc(generated)}</div></div>`;
  }

  /** Print to PDF through the shared Chromium. Throws PdfRendererUnavailableError without Chromium. */
  async save(): Promise<Uint8Array> {
    const result = await renderPdf({
      html: this.toHtml(),
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: this.footerTemplate(),
      margin: { top: "16mm", right: "14mm", bottom: "20mm", left: "14mm" },
    });
    if (result.mode !== "playwright") throw new PdfRendererUnavailableError();
    return new Uint8Array(result.buffer);
  }
}
