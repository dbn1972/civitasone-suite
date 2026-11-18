/**
 * MSME commercial M2: the sales invoice / credit-debit note as an issuable PDF (voucher-print's OfficialPdf engine). Pure: model in,
 * document out. The GST split printed is the one STORED on the document (never recomputed). A tax invoice carries the Rule 46
 * particulars: supplier name, address and GSTIN, serial number, date, recipient name / GSTIN, HSN/SAC, quantity, taxable value, rate
 * and amount of each tax, place of supply, reverse-charge flag.
 */
import {
  OfficialPdf, amountInWordsEn, formatDateIst, formatMinorIndian, type DocIdentity,
} from "@civitasone/render/official";

export interface InvoiceDocModel {
  kind: "invoice" | "credit_note" | "debit_note";
  docNo: string;
  docDate: string;
  dueDate: string | null;
  supplierGstin: string | null;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  placeOfSupplyName: string | null;
  supplyType: "intra" | "inter" | "none";
  reverseCharge: boolean;
  refInvoiceNo: string | null;
  lines: Array<{ description: string; hsnSac: string | null; qty: string; rateMinor: bigint; taxableMinor: bigint; gstRatePct: string; taxMinor: bigint; totalMinor: bigint }>;
  taxableMinor: bigint; cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint; totalMinor: bigint;
  narration: string | null;
}

export function titleFor(m: Pick<InvoiceDocModel, "kind" | "supplierGstin">): string {
  if (m.kind === "credit_note") return "Credit Note";
  if (m.kind === "debit_note") return "Debit Note";
  return m.supplierGstin ? "Tax Invoice" : "Invoice";
}

export async function buildInvoiceDoc(m: InvoiceDocModel, issuer: DocIdentity, generatedAt?: Date): Promise<OfficialPdf> {
  const title = titleFor(m);
  const pdf = await OfficialPdf.create({ title: `${title} ${m.docNo}`, lang: "en", footerNote: `${title} ${m.docNo}`, ...(generatedAt ? { generatedAt } : {}) });
  pdf.letterhead(issuer);
  pdf.title(title);
  pdf.refLine(`${title} No. ${m.docNo}`, `Date: ${formatDateIst(m.docDate)}`);
  pdf.fields([
    { label: "Supplier GSTIN", value: m.supplierGstin ?? "Not registered" },
    { label: "Recipient", value: m.customerName },
    { label: "Recipient GSTIN", value: m.customerGstin ?? "Unregistered" },
    { label: "Place of supply", value: `${m.placeOfSupply}${m.placeOfSupplyName ? ` - ${m.placeOfSupplyName}` : ""}` },
    { label: "Reverse charge", value: m.reverseCharge ? "Yes" : "No" },
    ...(m.dueDate ? [{ label: "Due date", value: formatDateIst(m.dueDate) }] : []),
    ...(m.refInvoiceNo ? [{ label: "Against invoice", value: m.refInvoiceNo }] : []),
  ]);
  const rows = m.lines.map((l, i) => [String(i + 1), l.description, l.hsnSac ?? "", l.qty, formatMinorIndian(l.rateMinor), formatMinorIndian(l.taxableMinor), `${l.gstRatePct}%`, formatMinorIndian(l.totalMinor)]);
  pdf.table({
    columns: [
      { header: "#", width: 0.4, align: "center" }, { header: "Description", width: 3 }, { header: "HSN/SAC", width: 1 }, { header: "Qty", width: 0.8, align: "right" },
      { header: "Rate", width: 1.1, align: "right" }, { header: "Taxable", width: 1.3, align: "right" }, { header: "GST", width: 0.7, align: "right" }, { header: "Amount", width: 1.4, align: "right" },
    ],
    rows,
    footRows: [["", "", "", "", "", formatMinorIndian(m.taxableMinor), "", formatMinorIndian(m.totalMinor)]],
    emptyText: "No lines.",
  });
  if (m.supplyType === "intra") pdf.fields([{ label: "CGST", value: formatMinorIndian(m.cgstMinor) }, { label: "SGST", value: formatMinorIndian(m.sgstMinor) }]);
  else if (m.supplyType === "inter") pdf.fields([{ label: "IGST", value: formatMinorIndian(m.igstMinor) }]);
  pdf.paragraph(`Amount in words: ${amountInWordsEn(m.totalMinor)}`, { bold: true });
  if (m.narration) pdf.paragraph(`Note: ${m.narration}`);
  return pdf;
}

export async function renderInvoicePdf(m: InvoiceDocModel, issuer: DocIdentity, generatedAt?: Date): Promise<Uint8Array> {
  return (await buildInvoiceDoc(m, issuer, generatedAt)).save();
}
