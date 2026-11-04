/**
 * Purchase order and goods receipt note as issuable PDFs (UAT ux-docs).
 *
 * PO "No line items" root cause: the old print route read `po.items` with fields `qty` and
 * `amountMinor`, but a PO has no `items` column - its lines live in po.procurement_po_items and
 * getPo() returns them as `lineItems` with `quantity` and `unitPriceMinor`. Every PO therefore
 * printed "No line items". poDocModel() maps the getPo() shape explicitly (golden-tested).
 */
import {
  OfficialPdf, amountInWordsEn, formatDateIst, formatInr, formatMinorIndian, gstSplit, toMinor,
  type DocIdentity, type Signatory,
} from "@civitasone/render/official";

export interface PoLine {
  itemCode: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: bigint;
  gstRateBp: number | null;
  hsnSac: string | null;
}

export interface PoDocModel {
  poNo: string;
  orderDate: string | null;
  deliveryDate: string | null;
  status: string;
  orderType: string;
  indentRef: string | null;
  sanctionRef: string | null;
  gemRef: string | null;
  recordedTotalMinor: bigint;
  vendor: { name: string; gstin: string | null; address: string | null };
  lines: PoLine[];
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : d);

/** getPo() output -> print model. Reads `lineItems` (the real field), never `items`. */
export function poDocModel(po: Record<string, unknown>, vendor: { gstin?: string | null; address?: string | null } | null): PoDocModel {
  const raw = Array.isArray(po.lineItems) ? (po.lineItems as Array<Record<string, unknown>>) : [];
  return {
    poNo: s(po.poNo) ?? "",
    orderDate: s(po.orderDate),
    deliveryDate: s(po.deliveryDate),
    status: s(po.status) ?? "",
    orderType: s(po.orderType) ?? "supply",
    indentRef: s(po.indentRef),
    sanctionRef: s(po.sanctionRef),
    gemRef: s(po.gemOrderNo) ?? s(po.gemOrderRef),
    recordedTotalMinor: toMinor(typeof po.totalMinor === "bigint" ? po.totalMinor : String(po.totalMinor ?? "0")),
    vendor: { name: s(po.vendorName) ?? s(po.vendor) ?? "", gstin: s(vendor?.gstin) , address: s(vendor?.address) },
    lines: raw.map((l) => ({
      itemCode: s(l.itemCode) ?? "",
      description: s(l.description) ?? s(l.itemName) ?? "",
      quantity: n(l.quantity, 0),
      unit: s(l.unit) ?? "nos",
      unitPriceMinor: toMinor(typeof l.unitPriceMinor === "number" ? Math.trunc(l.unitPriceMinor) : String(l.unitPriceMinor ?? "0")),
      gstRateBp: typeof l.gstRateBp === "number" ? l.gstRateBp : null,
      hsnSac: s(l.hsnSac),
    })),
  };
}

export interface PoTotals {
  taxableMinor: bigint;
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
  taxMinor: bigint;
  grandMinor: bigint;
  /** "intra" (CGST + SGST), "inter" (IGST), "unknown" (buyer GSTIN missing), "none" (no rated line), "unregistered" (supplier has no GSTIN: no GST). */
  kind: "intra" | "inter" | "unknown" | "none" | "unregistered";
  /** 1-based line numbers with no GST rate recorded. */
  unratedLines: number[];
  lineTax: bigint[];
}

export function poTotals(m: PoDocModel, buyer: Pick<DocIdentity, "gstin" | "stateCode">): PoTotals {
  const t: PoTotals = { taxableMinor: 0n, cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, taxMinor: 0n, grandMinor: 0n, kind: "none", unratedLines: [], lineTax: [] };
  const recipient = buyer.gstin ?? buyer.stateCode;
  // A supplier not registered under GST cannot charge GST: the order carries no tax at all.
  if (!m.vendor.gstin) {
    m.lines.forEach((l) => { t.taxableMinor += l.unitPriceMinor * BigInt(l.quantity); t.lineTax.push(0n); });
    t.grandMinor = t.taxableMinor;
    t.kind = "unregistered";
    return t;
  }
  m.lines.forEach((l, i) => {
    const taxable = l.unitPriceMinor * BigInt(l.quantity);
    t.taxableMinor += taxable;
    if (l.gstRateBp === null) { t.unratedLines.push(i + 1); t.lineTax.push(0n); return; }
    const g = gstSplit(taxable, l.gstRateBp, m.vendor.gstin, recipient);
    t.cgstMinor += g.cgstMinor; t.sgstMinor += g.sgstMinor; t.igstMinor += g.igstMinor; t.taxMinor += g.taxMinor;
    t.lineTax.push(g.taxMinor);
    t.kind = g.kind;
  });
  t.grandMinor = t.taxableMinor + t.taxMinor;
  return t;
}

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;

export const PO_TERMS: string[] = [
  "Delivery: the goods shall be delivered, at the cost and risk of the supplier, to the consignee named above by the delivery date stated in this order.",
  "Inspection and acceptance: the goods are subject to inspection on receipt. Goods found short, damaged or not to specification will be rejected and shall be replaced by the supplier at his own cost.",
  "Payment: payment will be released electronically to the bank account registered by the supplier, after receipt and acceptance of the goods (Goods Receipt Note) and on submission of a GST-compliant tax invoice quoting this order number and the buyer GSTIN.",
  "Taxes: GST is payable as shown above (CGST and SGST for a supply within the State, IGST for a supply from another State). Any change in the statutory rate on the date of supply will be applied.",
  "Liquidated damages: delay in delivery beyond the delivery date attracts liquidated damages at 0.5% of the value of the delayed goods per week or part thereof, subject to a maximum of 10% of the order value (GFR 2017).",
  "This order is governed by the General Financial Rules, 2017 and the procurement manual of the Government of India. Acceptance of this order shall be communicated within seven days of its receipt.",
];

export async function renderPoPdf(m: PoDocModel, buyer: DocIdentity, signatory: Signatory | null, generatedAt?: Date): Promise<Uint8Array> {
  const totals = poTotals(m, buyer);
  const pdf = await OfficialPdf.create({
    title: `Purchase Order ${m.poNo}`,
    lang: "bilingual",
    footerNote: `Purchase Order ${m.poNo}`,
    ...(generatedAt ? { generatedAt } : {}),
  });
  pdf.letterhead(buyer);
  pdf.title(m.orderType === "service" ? "Service Order" : m.orderType === "work" ? "Work Order" : "Purchase Order", m.orderType === "supply" ? "क्रय आदेश" : "कार्य आदेश");
  pdf.refLine(`No. ${m.poNo}`, `Dated: ${formatDateIst(m.orderDate)}`);
  pdf.fields([
    { label: "Supplier", value: [m.vendor.name, m.vendor.address].filter(Boolean).join(", ") },
    { label: "Supplier GSTIN", value: m.vendor.gstin ?? "Not registered under GST" },
    { label: "Buyer", value: [buyer.orgName, buyer.address].filter(Boolean).join(", ") },
    { label: "Buyer GSTIN", value: buyer.gstin ?? "" },
    { label: "Indent reference", value: m.indentRef ?? "" },
    { label: "Sanction reference", value: m.sanctionRef ?? "" },
    ...(m.gemRef ? [{ label: "GeM order", value: m.gemRef }] : []),
    { label: "Delivery by", value: formatDateIst(m.deliveryDate) },
  ]);
  const unregistered = totals.kind === "unregistered";
  const rateCell = (l: PoLine) => (unregistered ? "Nil" : l.gstRateBp === null ? "N.R." : pct(l.gstRateBp));
  pdf.table({
    size: 8.5,
    columns: [
      { header: "S. No.", width: 0.6, align: "center" },
      { header: "Item", width: 3.2 },
      { header: "HSN/SAC", width: 1 },
      { header: "Qty", width: 0.9, align: "right" },
      { header: "Rate (₹)", width: 1.2, align: "right" },
      { header: "Taxable value (₹)", width: 1.4, align: "right" },
      { header: "GST", width: 0.9, align: "right" },
      { header: "GST (₹)", width: 1.2, align: "right" },
    ],
    rows: m.lines.map((l, i) => [
      String(i + 1), [l.description, l.itemCode ? `(${l.itemCode})` : ""].filter(Boolean).join(" "), l.hsnSac ?? "—",
      `${l.quantity} ${l.unit}`, formatMinorIndian(l.unitPriceMinor), formatMinorIndian(l.unitPriceMinor * BigInt(l.quantity)),
      rateCell(l), unregistered || l.gstRateBp === null ? "—" : formatMinorIndian(totals.lineTax[i] ?? 0n),
    ]),
    emptyText: "This order has no line items.",
  });
  const sum: string[][] = [["Taxable value", formatMinorIndian(totals.taxableMinor)]];
  if (totals.kind === "intra") sum.push(["CGST", formatMinorIndian(totals.cgstMinor)], ["SGST / UTGST", formatMinorIndian(totals.sgstMinor)]);
  else if (totals.kind === "inter") sum.push(["IGST", formatMinorIndian(totals.igstMinor)]);
  else if (totals.kind === "unknown") sum.push(["GST (CGST/SGST or IGST: supplier or buyer GSTIN not recorded)", formatMinorIndian(totals.taxMinor)]);
  pdf.table({
    columns: [{ header: "Order value", width: 4 }, { header: "₹", width: 1.4, align: "right" }],
    rows: sum,
    footRows: [[totals.taxMinor > 0n ? "Total order value including GST" : "Total order value", formatMinorIndian(totals.grandMinor)]],
  });
  pdf.paragraph(`Amount in words: ${amountInWordsEn(totals.grandMinor)}`, { bold: true });
  if (unregistered) {
    pdf.note("The supplier is not registered under GST: no GST is charged on this order.");
  } else if (totals.unratedLines.length > 0) {
    pdf.note(`GST rate not recorded for line ${totals.unratedLines.join(", ")}: no tax is shown for ${totals.unratedLines.length === 1 ? "it" : "them"}; GST, where leviable, is payable against the supplier tax invoice.`);
  }
  if (m.recordedTotalMinor !== totals.taxableMinor) {
    pdf.note(`Order value as recorded (including amendments): ${formatInr(m.recordedTotalMinor)}.`);
  }
  pdf.heading("Terms and conditions");
  PO_TERMS.forEach((t, i) => pdf.paragraph(t, { prefix: `${i + 1}.`, size: 9, gapAfter: 2 }));
  pdf.signatures([{
    caption: buyer.orgName ? `For and on behalf of ${buyer.orgName}` : "Purchasing authority",
    name: signatory?.name ?? null,
    designation: signatory?.designation ?? (signatory ? null : "Purchase Officer (signature and seal)"),
  }]);
  return pdf.save();
}

export interface GrnDocModel {
  grnNo: string;
  receivedDate: string | null;
  status: string;
  poNo: string | null;
  vendor: string;
  notes: string | null;
  items: Array<{ itemCode: string; description: string; orderedQty: number; receivedQty: number; acceptedQty: number; unit: string }>;
  inspection: { result: string; date: string | null; remarks: string | null } | null;
}

export async function renderGrnPdf(m: GrnDocModel, buyer: DocIdentity, receivedBy: Signatory | null, inspectedBy: Signatory | null, generatedAt?: Date): Promise<Uint8Array> {
  const pdf = await OfficialPdf.create({ title: `Goods Receipt Note ${m.grnNo}`, lang: "bilingual", footerNote: `Goods Receipt Note ${m.grnNo}`, ...(generatedAt ? { generatedAt } : {}) });
  pdf.letterhead(buyer);
  pdf.title("Goods Receipt Note", "माल प्राप्ति नोट");
  pdf.refLine(`No. ${m.grnNo}`, `Dated: ${formatDateIst(m.receivedDate)}`);
  pdf.fields([
    { label: "PO No.", value: m.poNo ?? "" },
    { label: "Supplier", value: m.vendor },
    { label: "Status", value: m.status.replace(/_/g, " ") },
    { label: "Inspection", value: m.inspection ? `${m.inspection.result.replace(/_/g, " ")} on ${formatDateIst(m.inspection.date)}` : "Pending" },
  ]);
  pdf.table({
    columns: [
      { header: "S. No.", width: 0.6, align: "center" },
      { header: "Item", width: 3.4 },
      { header: "Ordered", width: 1, align: "right" },
      { header: "Received", width: 1, align: "right" },
      { header: "Accepted", width: 1, align: "right" },
      { header: "Rejected", width: 1, align: "right" },
    ],
    rows: m.items.map((it, i) => [
      String(i + 1), [it.description, it.itemCode ? `(${it.itemCode})` : ""].filter(Boolean).join(" "),
      `${it.orderedQty} ${it.unit}`, `${it.receivedQty} ${it.unit}`, `${it.acceptedQty} ${it.unit}`, `${Math.max(0, it.receivedQty - it.acceptedQty)} ${it.unit}`,
    ]),
    emptyText: "No items received.",
  });
  if (m.inspection?.remarks) pdf.paragraph(`Inspection remarks: ${m.inspection.remarks}`);
  if (m.notes) pdf.paragraph(`Notes: ${m.notes}`);
  pdf.paragraph("Certified that the goods listed above have been received in good condition, except as noted, and taken on stock.", { size: 9 });
  pdf.signatures([
    { caption: "Received by", name: receivedBy?.name ?? null, designation: receivedBy?.designation ?? null },
    { caption: m.inspection ? "Inspected by" : "Inspected by (inspection pending)", name: inspectedBy?.name ?? null, designation: inspectedBy?.designation ?? null },
  ]);
  return pdf.save();
}
