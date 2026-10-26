import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * Owner decision #27 (GAP-TENANT-ADMIN-SUBSCRIPTION-04): billing-service renders the
 * invoice PDF. Pure text layout (no HTML/browser dependency) so it is deterministic and
 * testable. Money is bigint minor units end to end; formatMinor never goes through a float.
 * pdf-lib's standard fonts are WinAnsi only, so the rupee sign is written as "INR" and any
 * other unencodable character is replaced rather than letting drawText throw.
 */
export interface InvoicePdfItem {
  description: string;
  kind: string;
  quantity: string;
  amountMinor: string;
  hsnSac: string | null;
}

export interface InvoicePdfModel {
  invoiceNumber: string;
  periodMonth: string;
  status: string;
  issuedAt: Date | string | null;
  supplierGstin: string | null;
  recipientGstin: string | null;
  placeOfSupply: string | null;
  taxMinor: string;
  cgstMinor: string;
  sgstMinor: string;
  igstMinor: string;
  totalMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  items: InvoicePdfItem[];
}

/** "INR 1,18,000.50" - Indian digit grouping, exact for any bigint. */
export function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, "0");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}INR ${grouped}.${frac}`;
}

const money = (v: string): string => formatMinor(BigInt(v));
const dash = (v: string | null): string => (v && v.length > 0 ? v : "-");

function issueDate(v: Date | string | null): string {
  if (!v) return "-";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
}

/** The text of the document, one entry per printed line (also what the unit test inspects). */
export function invoiceDocumentLines(m: InvoicePdfModel): string[] {
  const lines: string[] = [
    "TAX INVOICE",
    `Invoice no.: ${m.invoiceNumber}`,
    `Billing period: ${m.periodMonth}`,
    `Issue date: ${issueDate(m.issuedAt)}`,
    `Status: ${m.status}`,
    "",
    `Supplier GSTIN: ${dash(m.supplierGstin)}`,
    `Recipient GSTIN: ${dash(m.recipientGstin)}`,
    `Place of supply: ${dash(m.placeOfSupply)}`,
    "",
    "Line items (description | HSN/SAC | qty | amount)",
  ];
  for (const it of m.items) {
    lines.push(`${it.description.slice(0, 60)} | ${dash(it.hsnSac)} | ${it.quantity} | ${money(it.amountMinor)}${it.kind === "line" ? "" : ` (${it.kind})`}`);
  }
  lines.push(
    "",
    `CGST: ${money(m.cgstMinor)}`,
    `SGST: ${money(m.sgstMinor)}`,
    `IGST: ${money(m.igstMinor)}`,
    `Total tax: ${money(m.taxMinor)}`,
    `Invoice total: ${money(m.totalMinor)}`,
    `Paid: ${money(m.paidMinor)}`,
    `Outstanding: ${money(m.outstandingMinor)}`,
  );
  return lines;
}

const winAnsiSafe = (s: string): string => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function renderInvoicePdf(m: InvoicePdfModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font: PDFFont = await doc.embedFont(StandardFonts.Helvetica);
  const bold: PDFFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const MARGIN = 48;
  const SIZE = 10;
  const LEAD = 15;
  let page = doc.addPage([595.28, 841.89]);
  let y = page.getHeight() - MARGIN;
  for (const [i, line] of invoiceDocumentLines(m).entries()) {
    if (y < MARGIN) {
      page = doc.addPage([595.28, 841.89]);
      y = page.getHeight() - MARGIN;
    }
    const heading = i === 0;
    page.drawText(winAnsiSafe(line), { x: MARGIN, y, size: heading ? 16 : SIZE, font: heading ? bold : font, color: rgb(0, 0, 0) });
    y -= heading ? LEAD + 8 : LEAD;
  }
  return doc.save();
}
