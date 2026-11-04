import {
  OfficialPdf, amountInWordsEn, formatDateIst, formatMinorIndian, placeOfSupplyLabel, toMinor, type DocIdentity,
} from "@civitasone/render/official";

/**
 * Owner decision #27 (GAP-TENANT-ADMIN-SUBSCRIPTION-04): billing-service renders the
 * invoice PDF. Pure text layout (no HTML/browser dependency) so it is deterministic and
 * testable. Money is bigint minor units end to end; formatMinor never goes through a float.
 * UAT ux-docs: the PDF is laid out by the shared OfficialPdf builder with the embedded
 * Noto Sans Devanagari font (so the rupee sign and Hindi print), supplier and recipient
 * GSTIN, HSN/SAC, the CGST/SGST/IGST split and the amount in words.
 */
export interface InvoicePdfItem {
  description: string;
  kind: string;
  quantity: string;
  amountMinor: string;
  hsnSac: string | null;
}

export interface InvoicePdfModel {
  invoiceNumber: string | null;
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
    `Invoice no.: ${m.invoiceNumber ?? "-"}`,
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

/** Who issues the invoice (the platform operator) - deploy configuration, not tenant data. */
export function invoiceSupplierFromEnv(): { name: string | null; address: string | null } {
  const v = (k: string) => (process.env[k] ?? "").trim() || null;
  return { name: v("BILLING_SUPPLIER_NAME"), address: v("BILLING_SUPPLIER_ADDRESS") };
}

export async function renderInvoicePdf(
  m: InvoicePdfModel,
  parties: { supplier?: { name: string | null; address: string | null }; recipient?: DocIdentity } = {},
  generatedAt?: Date,
): Promise<Uint8Array> {
  const supplier = parties.supplier ?? invoiceSupplierFromEnv();
  const registered = !!(m.supplierGstin && m.supplierGstin.length > 0);
  const pdf = await OfficialPdf.create({
    title: `${registered ? "Tax Invoice" : "Bill of Supply"} ${m.invoiceNumber ?? ""}`.trim(),
    lang: "bilingual",
    footerNote: `${registered ? "Tax invoice" : "Bill of supply"} ${m.invoiceNumber ?? ""}`.trim(),
    ...(generatedAt ? { generatedAt } : {}),
  });
  pdf.letterhead({ orgName: supplier.name, address: supplier.address });
  pdf.title(registered ? "TAX INVOICE" : "BILL OF SUPPLY", registered ? "कर बीजक" : "आपूर्ति का बिल");
  pdf.refLine(`Invoice No. ${m.invoiceNumber ?? "-"}`, `Dated: ${formatDateIst(m.issuedAt instanceof Date ? m.issuedAt : m.issuedAt ?? null)}`);
  const r = parties.recipient;
  pdf.fields([
    { label: "Supplier GSTIN", value: m.supplierGstin ?? "Not registered under GST" },
    { label: "Recipient GSTIN", value: m.recipientGstin ?? "Unregistered recipient" },
    { label: "Bill to", value: [r?.orgName, r?.address].filter(Boolean).join(", ") },
    { label: "Place of supply", value: placeOfSupplyLabel(m.placeOfSupply) },
    { label: "Billing period", value: m.periodMonth },
    { label: "Status", value: m.status },
  ]);
  const lines = m.items.filter((it) => it.kind !== "tax");
  const taxable = lines.reduce((a, it) => a + toMinor(it.amountMinor), 0n);
  pdf.table({
    columns: [
      { header: "S. No.", width: 0.6, align: "center" },
      { header: "Description", width: 4 },
      { header: "HSN/SAC", width: 1.1 },
      { header: "Qty", width: 0.7, align: "right" },
      { header: "Taxable value (₹)", width: 1.6, align: "right" },
    ],
    rows: lines.map((it, i) => [String(i + 1), it.kind === "line" ? it.description : `${it.description} (${it.kind})`, it.hsnSac ?? "—", it.quantity, formatMinorIndian(toMinor(it.amountMinor))]),
    emptyText: "No line items.",
  });
  const cgst = toMinor(m.cgstMinor), sgst = toMinor(m.sgstMinor), igst = toMinor(m.igstMinor), tax = toMinor(m.taxMinor), total = toMinor(m.totalMinor);
  const rows: string[][] = [["Taxable value", formatMinorIndian(taxable)]];
  if (cgst > 0n || sgst > 0n) rows.push(["CGST", formatMinorIndian(cgst)], ["SGST / UTGST", formatMinorIndian(sgst)]);
  if (igst > 0n) rows.push(["IGST", formatMinorIndian(igst)]);
  if (cgst === 0n && sgst === 0n && igst === 0n && tax > 0n) rows.push(["GST", formatMinorIndian(tax)]);
  pdf.table({
    columns: [{ header: "Summary", width: 4 }, { header: "₹", width: 1.6, align: "right" }],
    rows,
    footRows: [["Invoice total", formatMinorIndian(total)], ["Paid", formatMinorIndian(toMinor(m.paidMinor))], ["Outstanding", formatMinorIndian(toMinor(m.outstandingMinor))]],
  });
  pdf.paragraph(`Amount in words: ${amountInWordsEn(total)}`, { bold: true });
  if (!registered) pdf.note("The supplier is not registered under GST: this is a bill of supply and no GST is charged on it.");
  pdf.note("This is a computer-generated invoice.");
  return pdf.save();
}
