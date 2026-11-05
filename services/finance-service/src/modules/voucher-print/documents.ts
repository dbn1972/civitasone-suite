/**
 * Finance documents as issuable PDFs (UAT ux-docs): the journal / payment voucher and the
 * sanction order. Pure: model in, PDF bytes out.
 */
import {
  OfficialPdf, amountInWordsEn, amountInWordsHi, financialYearOf, formatDateIst, formatInr, formatMinorIndian,
  type DocIdentity, type Signatory,
} from "@civitasone/render/official";

// ── Journal voucher ───────────────────────────────────────────────────────

export interface VoucherDocModel {
  voucherNo: string;
  postingDate: string | null;
  type: string;
  status: string;
  lines: Array<{ accountCode: string; accountName: string | null; debitMinor: bigint; creditMinor: bigint; narration: string | null }>;
  preparedBy: Signatory | null;
  preparedAt: string | null;
  approvedBy: Signatory | null;
  approvedAt: string | null;
  /** True when the voucher was posted automatically on approval of its source (payroll, GRN, ...). */
  system: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  journal: "Journal Voucher", manual: "Journal Voucher", payment: "Payment Voucher", receipt: "Receipt Voucher",
  payroll_accrual: "Journal Voucher (Payroll accrual)", payroll_settlement: "Payment Voucher (Payroll settlement)",
  depreciation: "Journal Voucher (Depreciation)", asset_disposal: "Journal Voucher (Asset disposal)",
};

export function voucherTitle(type: string): string {
  return TYPE_LABELS[type] ?? `Journal Voucher (${type.replace(/_/g, " ")})`;
}

/** One narration for the voucher: the distinct line narrations, in order. */
export function voucherNarration(lines: VoucherDocModel["lines"]): string {
  return [...new Set(lines.map((l) => (l.narration ?? "").trim()).filter(Boolean))].join("; ");
}

export async function renderVoucherPdf(m: VoucherDocModel, issuer: DocIdentity, generatedAt?: Date): Promise<Uint8Array> {
  const pdf = await OfficialPdf.create({ title: `${voucherTitle(m.type)} ${m.voucherNo}`, lang: "bilingual", footerNote: `Voucher ${m.voucherNo}`, ...(generatedAt ? { generatedAt } : {}) });
  pdf.letterhead(issuer);
  pdf.title(voucherTitle(m.type), m.type.includes("payment") ? "भुगतान वाउचर" : "जर्नल वाउचर");
  pdf.refLine(`Voucher No. ${m.voucherNo}`, `Dated: ${formatDateIst(m.postingDate)}`);
  pdf.fields([
    { label: "Financial year", value: m.postingDate ? financialYearOf(m.postingDate) : "" },
    { label: "Status", value: m.status.replace(/_/g, " ") },
  ]);
  let dr = 0n, cr = 0n;
  const rows = m.lines.map((l, i) => {
    dr += l.debitMinor; cr += l.creditMinor;
    return [String(i + 1), l.accountCode, l.accountName ?? "Account not in chart of accounts", l.debitMinor ? formatMinorIndian(l.debitMinor) : "", l.creditMinor ? formatMinorIndian(l.creditMinor) : ""];
  });
  pdf.table({
    columns: [
      { header: "S. No.", width: 0.6, align: "center" },
      { header: "Account code", width: 1.2 },
      { header: "Account head", width: 3.6 },
      { header: "Debit (₹)", width: 1.4, align: "right" },
      { header: "Credit (₹)", width: 1.4, align: "right" },
    ],
    rows,
    footRows: [["", "", "Total", formatMinorIndian(dr), formatMinorIndian(cr)]],
    emptyText: "No lines.",
  });
  pdf.paragraph(`Amount in words: ${amountInWordsEn(dr)}`, { bold: true });
  const narration = voucherNarration(m.lines);
  pdf.paragraph(`Narration: ${narration || "None recorded"}`);
  if (m.system) pdf.note("System-generated voucher: posted automatically on approval of the source transaction.");
  const who = (s: Signatory | null) => s?.name ?? null;
  pdf.signatures([
    { caption: "Prepared by", name: who(m.preparedBy), designation: m.preparedBy?.designation ?? null, extra: [m.preparedAt ? formatDateIst(m.preparedAt) : null] },
    { caption: "Approved by", name: who(m.approvedBy), designation: m.approvedBy?.designation ?? null, extra: [m.approvedAt ? formatDateIst(m.approvedAt) : null] },
  ]);
  return pdf.save();
}

// ── Sanction order ────────────────────────────────────────────────────────

export interface SanctionOrderModel {
  sanctionNo: string;
  purpose: string;
  amountMinor: bigint;
  approvedAt: string;
  head: { code: string; hoaCode: string | null; name: string } | null;
  efileFileNo: string | null;
  signatory: Signatory;
}

export const SANCTION_CONDITIONS: string[] = [
  "The expenditure shall be incurred in accordance with the General Financial Rules, 2017 and the delegation of financial powers in force, after following the prescribed procurement procedure.",
  "The expenditure shall not exceed the amount sanctioned. Any saving shall be surrendered and shall not be diverted to any other purpose without fresh sanction.",
  "The sanction is valid for the financial year stated in paragraph 2; any unutilised balance lapses at the close of that financial year.",
  "A utilisation certificate and accounts of the expenditure shall be rendered to the sanctioning authority on completion.",
];

export async function renderSanctionOrderPdf(m: SanctionOrderModel, issuer: DocIdentity, generatedAt?: Date): Promise<Uint8Array> {
  const pdf = await OfficialPdf.create({ title: `Sanction Order ${m.sanctionNo}`, lang: "bilingual", footerNote: `Sanction Order ${m.sanctionNo}`, ...(generatedAt ? { generatedAt } : {}) });
  pdf.letterhead(issuer);
  pdf.refLine(`No. ${m.sanctionNo}`, `Dated: ${formatDateIst(m.approvedAt)}`);
  pdf.title("SANCTION ORDER", "स्वीकृति आदेश");
  pdf.paragraph(`Subject: ${m.purpose}`, { bold: true, gapAfter: 8 });
  const amount = formatInr(m.amountMinor);
  const fy = financialYearOf(m.approvedAt);
  const hoa = m.head ? `${m.head.hoaCode ? `${m.head.hoaCode} ` : ""}(${m.head.code}) ${m.head.name}` : "the head of account recorded on this sanction";
  pdf.paragraph(`Sanction of the competent authority is hereby accorded to an expenditure of ${amount} (${amountInWordsEn(m.amountMinor)}) towards ${m.purpose}.`, { prefix: "1." });
  pdf.paragraph(`(${amountInWordsHi(m.amountMinor)})`, { indent: 20, gapAfter: 6 });
  pdf.paragraph(`The expenditure is debitable to the Head of Account: ${hoa}, for the financial year ${fy}.`, { prefix: "2." });
  pdf.paragraph("The sanction is subject to the following conditions:", { prefix: "3." });
  SANCTION_CONDITIONS.forEach((c, i) => pdf.paragraph(c, { prefix: `(${String.fromCharCode(97 + i)})`, indent: 20, gapAfter: 2 }));
  pdf.paragraph(
    m.efileFileNo
      ? `This sanction issues with the approval of the competent authority on e-Office file No. ${m.efileFileNo}.`
      : `This sanction issues with the approval of the competent authority recorded on ${formatDateIst(m.approvedAt)}.`,
    { prefix: "4." },
  );
  pdf.fields([
    { label: "Amount (in figures)", value: amount },
    { label: "Head of Account", value: hoa },
  ], 1);
  pdf.signatures([{ name: m.signatory.name, designation: m.signatory.designation, extra: [issuer.orgName ?? null] }]);
  pdf.heading("Copy to:", 10);
  ["The Pay and Accounts Officer concerned.", "The Drawing and Disbursing Officer concerned.", "Sanction file / Guard file."]
    .forEach((c, i) => pdf.paragraph(c, { prefix: `${i + 1}.`, size: 9, gapAfter: 1 }));
  return pdf.save();
}

