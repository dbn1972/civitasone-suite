/**
 * court-documents — pure pdf-lib rendering helpers.
 *
 * These functions take already-fetched, RLS-scoped data (the routes do the
 * reads) and emit an A4 PDF as a `Uint8Array`. No I/O, no DB, no PII beyond
 * what the legal document legitimately prints. Dependency-light: pdf-lib +
 * StandardFonts.Helvetica / HelveticaBold only.
 *
 * Layout primitives (A4 = 595.28 x 841.89 pt):
 *   - drawHeader  — "COURT OF <name>" + a document title + a subtitle + a rule.
 *   - drawKeyValue — a bold label followed by a value on one line.
 *   - drawTable   — a simple bordered column/row grid (used by the cause list).
 *   - wrapText / drawParagraph — manual word-wrap measured with widthOfTextAtSize.
 */
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";

// ─── Page geometry ───────────────────────────────────────────────────────────
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const INK = rgb(0.1, 0.1, 0.1);
const RULE = rgb(0.4, 0.4, 0.4);
const FAINT = rgb(0.72, 0.72, 0.72);
const SEAL = rgb(0.15, 0.32, 0.15);

/** A mutable cursor threading the current write position down a page. */
interface Cursor {
  page: PDFPage;
  y: number;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function newPage(doc: PDFDocument): Cursor {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  return { page, y: A4_HEIGHT - MARGIN };
}

/** Ensure at least `need` points of vertical room remain; page-break if not. */
function ensureRoom(doc: PDFDocument, cur: Cursor, need: number): void {
  if (cur.y - need < MARGIN) {
    const next = newPage(doc);
    cur.page = next.page;
    cur.y = next.y;
  }
}

/**
 * Word-wrap `text` to at most `maxWidth`, measured in `font` at `size`.
 * Splits on whitespace; a single over-long token is hard-broken by characters
 * so it can never overflow the page width.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line.length > 0) {
        lines.push(line);
        line = "";
      }
      // Hard-break a single token wider than the column.
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word;
      } else {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) {
            chunk += ch;
          } else {
            if (chunk.length > 0) lines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      }
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/** Header block: court name, a title, an optional subtitle, and a rule line. */
function drawHeader(
  doc: PDFDocument,
  cur: Cursor,
  fonts: Fonts,
  title: string,
  subtitle: string,
): void {
  ensureRoom(doc, cur, 90);
  // The court identity line is drawn by drawCourtName() just above; here we
  // print the document heading + subtitle + a rule.
  cur.page.drawText(title, { x: MARGIN, y: cur.y, size: 18, font: fonts.bold, color: INK });
  cur.y -= 18;
  if (subtitle.length > 0) {
    cur.page.drawText(subtitle, { x: MARGIN, y: cur.y, size: 10, font: fonts.regular, color: RULE });
    cur.y -= 14;
  }
  cur.y -= 4;
  cur.page.drawLine({
    start: { x: MARGIN, y: cur.y },
    end: { x: A4_WIDTH - MARGIN, y: cur.y },
    thickness: 1,
    color: RULE,
  });
  cur.y -= 18;
}

/** Court-identity line drawn above the header title. */
function drawCourtName(cur: Cursor, fonts: Fonts, courtName: string): void {
  cur.page.drawText(`COURT OF ${courtName}`.toUpperCase(), {
    x: MARGIN,
    y: cur.y,
    size: 11,
    font: fonts.bold,
    color: INK,
  });
  cur.y -= 16;
}

/** A bold `label:` followed by its value on the same line. */
function drawKeyValue(cur: Cursor, fonts: Fonts, label: string, value: string): void {
  const labelText = `${label}: `;
  cur.page.drawText(labelText, { x: MARGIN, y: cur.y, size: 10, font: fonts.bold, color: INK });
  const labelWidth = fonts.bold.widthOfTextAtSize(labelText, 10);
  cur.page.drawText(value, { x: MARGIN + labelWidth, y: cur.y, size: 10, font: fonts.regular, color: INK });
  cur.y -= 15;
}

/** Word-wrapped paragraph body. */
function drawParagraph(doc: PDFDocument, cur: Cursor, fonts: Fonts, text: string, size = 11): void {
  const lines = wrapText(text, fonts.regular, size, CONTENT_WIDTH);
  const lineHeight = size + 4;
  for (const line of lines) {
    ensureRoom(doc, cur, lineHeight);
    if (line.length > 0) {
      cur.page.drawText(line, { x: MARGIN, y: cur.y, size, font: fonts.regular, color: INK });
    }
    cur.y -= lineHeight;
  }
}

/**
 * A simple bordered table. `columns` are (header, width-fraction) pairs whose
 * fractions should sum to ~1; each row is a same-length array of cell strings.
 * Long cell text is clipped (not wrapped) to keep the grid tidy.
 */
function drawTable(
  doc: PDFDocument,
  cur: Cursor,
  fonts: Fonts,
  columns: { header: string; frac: number }[],
  rows: string[][],
): void {
  const rowHeight = 20;
  const size = 9;
  const xs: number[] = [];
  let acc = MARGIN;
  for (const col of columns) {
    xs.push(acc);
    acc += col.frac * CONTENT_WIDTH;
  }
  const right = A4_WIDTH - MARGIN;

  const drawRow = (cells: string[], font: PDFFont, top: number): void => {
    // Cell borders.
    cur.page.drawRectangle({
      x: MARGIN,
      y: top - rowHeight,
      width: CONTENT_WIDTH,
      height: rowHeight,
      borderColor: RULE,
      borderWidth: 0.5,
    });
    for (let i = 0; i < columns.length; i++) {
      const cellX = xs[i] ?? MARGIN;
      const nextX = i + 1 < xs.length ? (xs[i + 1] ?? right) : right;
      const cellWidth = nextX - cellX - 8;
      const raw = cells[i] ?? "";
      let text = raw;
      // Clip to the cell width.
      while (text.length > 0 && font.widthOfTextAtSize(text, size) > cellWidth) {
        text = text.slice(0, -1);
      }
      cur.page.drawText(text, { x: cellX + 4, y: top - rowHeight + 6, size, font, color: INK });
    }
  };

  ensureRoom(doc, cur, rowHeight * 2);
  drawRow(columns.map((c) => c.header), fonts.bold, cur.y);
  cur.y -= rowHeight;
  for (const row of rows) {
    ensureRoom(doc, cur, rowHeight);
    drawRow(row, fonts.regular, cur.y);
    cur.y -= rowHeight;
  }
}

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { regular, bold };
}

// ─── Public renderers ────────────────────────────────────────────────────────

export interface CauseListItemData {
  itemNo: number | null;
  caseRef: string;
  slot: string | null;
  courtroom: string | null;
}

export interface CauseListData {
  courtName: string;
  listDate: string;
  items: CauseListItemData[];
}

/** CAUSE LIST — court name, list date, and an Item/Case/Slot/Courtroom table. */
export async function renderCauseListPdf(data: CauseListData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);
  const cur = newPage(doc);

  drawCourtName(cur, fonts, data.courtName);
  drawHeader(doc, cur, fonts, "CAUSE LIST", `List date: ${data.listDate}`);

  drawTable(
    doc,
    cur,
    fonts,
    [
      { header: "Item No", frac: 0.14 },
      { header: "CNR / Case", frac: 0.46 },
      { header: "Slot", frac: 0.2 },
      { header: "Courtroom", frac: 0.2 },
    ],
    data.items.map((it) => [
      it.itemNo === null ? "—" : String(it.itemNo),
      it.caseRef,
      it.slot ?? "—",
      it.courtroom ?? "—",
    ]),
  );

  cur.y -= 12;
  ensureRoom(doc, cur, 20);
  cur.page.drawText(`Generated ${data.items.length} item${data.items.length === 1 ? "" : "s"}.`, {
    x: MARGIN,
    y: cur.y,
    size: 9,
    font: fonts.regular,
    color: RULE,
  });

  return doc.save();
}

export interface OrderData {
  courtName: string;
  caption: string;
  cnr: string;
  orderType: string | null;
  orderDate: string | null;
  orderText: string;
  status: string;
  signedBy: string | null;
  hasDsc: boolean;
}

/** ORDER / JUDGMENT — caption, CNR, date, wrapped body, signature block. */
export async function renderOrderPdf(data: OrderData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);
  const cur = newPage(doc);

  const isJudgment = (data.orderType ?? "").toLowerCase().includes("judgment");
  const heading = isJudgment ? "JUDGMENT" : "ORDER";

  drawCourtName(cur, fonts, data.courtName);
  drawHeader(doc, cur, fonts, heading, data.caption);

  drawKeyValue(cur, fonts, "CNR", data.cnr);
  drawKeyValue(cur, fonts, "Date", data.orderDate ?? "—");
  cur.y -= 6;

  // DRAFT watermark line for anything not yet issued.
  if (data.status !== "issued") {
    ensureRoom(doc, cur, 20);
    cur.page.drawText("DRAFT — NOT FOR ISSUE", {
      x: MARGIN,
      y: cur.y,
      size: 14,
      font: fonts.bold,
      color: FAINT,
    });
    cur.y -= 22;
  }

  drawParagraph(doc, cur, fonts, data.orderText.length > 0 ? data.orderText : "(no order text)");

  // Signature block.
  cur.y -= 16;
  ensureRoom(doc, cur, 60);
  cur.page.drawLine({
    start: { x: MARGIN, y: cur.y },
    end: { x: A4_WIDTH - MARGIN, y: cur.y },
    thickness: 0.5,
    color: RULE,
  });
  cur.y -= 16;
  drawKeyValue(cur, fonts, "Signed by", data.signedBy ?? "—");
  if (data.hasDsc) {
    cur.page.drawText("Digitally signed (DSC)", {
      x: MARGIN,
      y: cur.y,
      size: 10,
      font: fonts.bold,
      color: SEAL,
    });
    cur.y -= 15;
  }
  drawKeyValue(cur, fonts, "Status", data.status === "issued" ? "ISSUED" : data.status.toUpperCase());

  return doc.save();
}

export interface CertifiedCopyData {
  courtName: string;
  copyId: string;
  status: string;
  copiesCount: number;
  issuedBy: string | null;
  issuedAt: string | null;
  orderText: string | null;
  caption?: string | undefined;
  cnr?: string | undefined;
}

/** CERTIFIED COPY — source order text + a "CERTIFIED TRUE COPY" seal box. */
export async function renderCertifiedCopyPdf(data: CertifiedCopyData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);
  const cur = newPage(doc);

  drawCourtName(cur, fonts, data.courtName);
  drawHeader(doc, cur, fonts, "CERTIFIED COPY", data.caption ?? "");

  if (data.cnr && data.cnr.length > 0) {
    drawKeyValue(cur, fonts, "CNR", data.cnr);
    cur.y -= 4;
  }

  cur.page.drawText("Source document:", { x: MARGIN, y: cur.y, size: 10, font: fonts.bold, color: INK });
  cur.y -= 16;
  drawParagraph(doc, cur, fonts, data.orderText && data.orderText.length > 0 ? data.orderText : "(source order text unavailable)");

  cur.y -= 20;

  if (data.status === "issued") {
    // Prominent seal box.
    const boxHeight = 92;
    ensureRoom(doc, cur, boxHeight + 10);
    const boxTop = cur.y;
    cur.page.drawRectangle({
      x: MARGIN,
      y: boxTop - boxHeight,
      width: CONTENT_WIDTH,
      height: boxHeight,
      borderColor: SEAL,
      borderWidth: 1.5,
    });
    let ty = boxTop - 20;
    cur.page.drawText("CERTIFIED TRUE COPY", { x: MARGIN + 16, y: ty, size: 15, font: fonts.bold, color: SEAL });
    ty -= 20;
    cur.page.drawText(`Copy ID: ${data.copyId}`, { x: MARGIN + 16, y: ty, size: 9, font: fonts.regular, color: INK });
    ty -= 14;
    cur.page.drawText(`Copies: ${data.copiesCount}    Issued by: ${data.issuedBy ?? "—"}`, {
      x: MARGIN + 16, y: ty, size: 9, font: fonts.regular, color: INK,
    });
    ty -= 14;
    cur.page.drawText(`Issued at: ${data.issuedAt ?? "—"}`, { x: MARGIN + 16, y: ty, size: 9, font: fonts.regular, color: INK });
    cur.y = boxTop - boxHeight - 10;
  } else {
    ensureRoom(doc, cur, 40);
    cur.page.drawText("NOT YET ISSUED — provisional", {
      x: MARGIN,
      y: cur.y,
      size: 15,
      font: fonts.bold,
      color: FAINT,
    });
    cur.y -= 20;
    drawKeyValue(cur, fonts, "Copy ID", data.copyId);
    drawKeyValue(cur, fonts, "Status", data.status.toUpperCase());
  }

  return doc.save();
}
