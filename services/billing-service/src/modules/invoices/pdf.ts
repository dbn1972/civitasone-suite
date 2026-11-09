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
export function invoiceSupplierFromEnv(): { name: string | null; address: string | null; signatory: string | null } {
  const v = (k: string) => (process.env[k] ?? "").trim() || null;
  return { name: v("BILLING_SUPPLIER_NAME"), address: v("BILLING_SUPPLIER_ADDRESS"), signatory: v("BILLING_SUPPLIER_SIGNATORY") };
}

/** Rule 46(a): an invoice must name its supplier. Thrown when the supplier name is not configured (route: 422). */
export class InvoiceSupplierNotConfiguredError extends Error {
  readonly code = "INVOICE_SUPPLIER_NOT_CONFIGURED";
  constructor() {
    super("the invoice cannot be issued: the supplier name is not configured (BILLING_SUPPLIER_NAME, with BILLING_SUPPLIER_ADDRESS)");
  }
}

/** The rate of one tax head, from its amount and the taxable value ("9%", "0.125%"). */
export function taxRateLabel(taxMinor: bigint, taxableMinor: bigint): string {
  if (taxableMinor <= 0n || taxMinor <= 0n) return "";
  // basis points, rounded half up, then shown without trailing zeros
  const bp = (taxMinor * 20000n + taxableMinor) / (taxableMinor * 2n);
  const pct = Number(bp) / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toString()}%`;
}

export async function renderInvoicePdf(
  m: InvoicePdfModel,
  parties: { supplier?: { name: string | null; address: string | null; signatory?: string | null }; recipient?: DocIdentity } = {},
  generatedAt?: Date,
): Promise<Uint8Array> {
  const supplier = parties.supplier ?? invoiceSupplierFromEnv();
  if (!supplier.name) throw new InvoiceSupplierNotConfiguredError();
  const hasGstin = !!(m.supplierGstin && m.supplierGstin.length > 0);
  // CGST Rule 46 / Rule 49: a tax invoice is for a taxable supply. A registered supplier's nil-tax (exempt / nil-rated)
  // supply is made on a bill of supply, which still carries the supplier GSTIN. So: tax invoice = GSTIN and tax > 0.
  const registered = hasGstin && toMinor(m.taxMinor) > 0n;
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
  ]);
  // Rule 46(p): the supplies billed here are not notified for reverse charge.
  if (registered) pdf.paragraph("Whether tax is payable on reverse charge: No", { size: 9.5 });
  const lines = m.items.filter((it) => it.kind !== "tax");
  // B22 D2: an item's amount is PER UNIT (computeTotals in domain.ts bills amount x quantity), so the printed
  // amount and the taxable value are amount x quantity. The PDF used to print and sum the bare unit amount
  // (2 x 1,000.00 showed 1,000.00 and a total of 1,050.00 against a stored 2,410.00).
  const lineValue = (it: InvoicePdfItem): bigint => toMinor(it.amountMinor) * toMinor(it.quantity);
  const taxable = lines.reduce((a, it) => a + lineValue(it), 0n);
  pdf.table({
    columns: [
      { header: "S. No.", width: 0.6, align: "center" },
      { header: "Description", width: 3.2 },
      { header: "HSN/SAC", width: 1.1 },
      { header: "Qty", width: 0.6, align: "right" },
      { header: "Rate (₹)", width: 1.3, align: "right" },
      { header: "Amount (₹)", width: 1.5, align: "right" },
    ],
    rows: lines.map((it, i) => [String(i + 1), it.kind === "line" ? it.description : `${it.description} (${it.kind})`, it.hsnSac ?? "—", it.quantity, formatMinorIndian(toMinor(it.amountMinor)), formatMinorIndian(lineValue(it))]),
    emptyText: "No line items.",
  });
  // The totals printed are the invoice's STORED totals (total, paid, outstanding), never a re-sum of the lines.
  const total = toMinor(m.totalMinor);
  const cgst = toMinor(m.cgstMinor), sgst = toMinor(m.sgstMinor), igst = toMinor(m.igstMinor), tax = toMinor(m.taxMinor);
  const paid = toMinor(m.paidMinor), outstanding = toMinor(m.outstandingMinor);
  if (registered) {
    const rows: string[][] = [["Taxable value", "", formatMinorIndian(taxable)]];
    // Rule 46(k)-(l): rate and amount for each tax head.
    if (cgst > 0n || sgst > 0n) rows.push(["CGST", taxRateLabel(cgst, taxable), formatMinorIndian(cgst)], ["SGST / UTGST", taxRateLabel(sgst, taxable), formatMinorIndian(sgst)]);
    if (igst > 0n) rows.push(["IGST", taxRateLabel(igst, taxable), formatMinorIndian(igst)]);
    if (cgst === 0n && sgst === 0n && igst === 0n && tax > 0n) rows.push(["GST", taxRateLabel(tax, taxable), formatMinorIndian(tax)]);
    pdf.table({
      columns: [{ header: "Summary", width: 3.4 }, { header: "Rate", width: 0.8, align: "right" }, { header: "₹", width: 1.6, align: "right" }],
      rows,
      footRows: [["Invoice total", "", formatMinorIndian(total)], ["Paid", "", formatMinorIndian(paid)], ["Outstanding", "", formatMinorIndian(outstanding)]],
    });
    pdf.paragraph(`Amount in words: ${amountInWordsEn(total)}`, { bold: true });
  } else {
    // Bill of supply: an unregistered supplier cannot charge GST (CGST Act s.9/s.10; Rule 49), and issue now refuses a
    // bill that carries tax and no supplier GSTIN (B22 D3). A bill issued before that rule can still hold a tax line:
    // it is printed as recorded (so the document matches the record and what was paid), never silently dropped.
    const rows: string[][] = [["Value of supply", formatMinorIndian(taxable)]];
    if (tax > 0n) rows.push(["Tax as recorded (no supplier GSTIN on record)", formatMinorIndian(tax)]);
    pdf.table({
      columns: [{ header: "Summary", width: 4 }, { header: "₹", width: 1.6, align: "right" }],
      rows,
      footRows: [["Total", formatMinorIndian(total)], ["Paid", formatMinorIndian(paid)], ["Outstanding", formatMinorIndian(outstanding)]],
    });
    pdf.paragraph(`Amount in words: ${amountInWordsEn(total)}`, { bold: true });
    pdf.note(hasGstin
      ? "This is a bill of supply: the supply carries no tax, so no GST is charged on it."
      : tax > 0n
      ? "The supplier GSTIN is not on record: this is a bill of supply. The tax shown was recorded on the invoice before GST registration was enforced at issue; it is not a GST charge and carries no input tax credit."
      : "The supplier is not registered under GST: this is a bill of supply and no GST is charged on it.");
  }
  // Rule 46(q): signature of the supplier or its authorised representative.
  pdf.signatures([{ caption: `For ${supplier.name}`, name: supplier.signatory ?? null, designation: "Authorised Signatory" }]);
  return pdf.save();
}
