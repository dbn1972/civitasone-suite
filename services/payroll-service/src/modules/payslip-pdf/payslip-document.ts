/**
 * Salary slip as an issuable PDF (UAT ux-docs). Pure: model in, PDF bytes out.
 *
 *  - bilingual headings (Hindi + English); with lang "hi" the labels lead in Hindi and the net
 *    pay is also written in Hindi words;
 *  - net pay in words in the Indian system (lakh / crore);
 *  - PAN printed masked (XXXXX1234X), bank account last four only;
 *  - designation, pay level and UAN from the HRMS record;
 *  - employer NPS / PF contributions shown as employer contributions, NOT as deductions
 *    (they are paid over and above the salary and never reduce net pay).
 */
import {
  OfficialPdf, amountInWordsEn, amountInWordsHi, formatMinorIndian, formatMonthYear, maskAccountForPrint, maskPanForPrint,
  toMinor, type DocIssuer,
} from "@civitasone/render/official";

export interface SlipComponent { code: string; name: string; type: string; amountMinor: number | bigint | string }

export interface PayslipDocInput {
  lang: "en" | "hi";
  issuer: DocIssuer;
  ddoName?: string | null;
  ddoCode?: string | null;
  signatoryTitle?: string | null;
  showSignatureBlock?: boolean;
  /** Pay period, YYYY-MM. */
  month: string;
  employee: {
    employeeNo: string;
    name: string;
    designation: string | null;
    payLevel: number | null;
    payGrade: string | null;
    /** S8-G4: the designation's private grade band (C2, T3 ...). Absent/null on a government tenant. */
    gradeBand?: { code: string; name: string } | null;
    department: string | null;
    pan: string | null;
    uan: string | null;
    bankAccount: string | null;
    bankIfsc: string | null;
  };
  slip: {
    components: SlipComponent[];
    grossMinor: bigint;
    totalDeductionsMinor: bigint;
    netPayMinor: bigint;
    pfEmployeeMinor: bigint;
    pfEmployerMinor: bigint;
    gpfMinor: bigint;
    npsEmployeeMinor: bigint;
    npsEmployerMinor: bigint;
    /** UPS scheme slip (bundle 17-19 SF7): the NPS columns hold the UPS shares; the pool share is its own statutory row. */
    isUps?: boolean;
    upsPoolMinor?: bigint;
    esiMinor: bigint;
    tdsMinor: bigint;
  };
  generatedAt?: Date;
}

export interface SlipRow { label: string; amountMinor: bigint }

/** Statutory employee deductions held as slip columns; listed unless already a component of the same code. */
const EMPLOYEE_STATUTORY: Array<{ key: keyof PayslipDocInput["slip"]; codes: string[]; label: string }> = [
  { key: "gpfMinor", codes: ["GPF"], label: "GPF subscription" },
  { key: "npsEmployeeMinor", codes: ["NPS", "NPS_EMP", "NPS_EMPLOYEE", "UPS", "UPS_EMP"], label: "NPS (employee contribution)" },
  { key: "pfEmployeeMinor", codes: ["PF", "EPF", "PF_EMP", "EPF_EMPLOYEE"], label: "EPF (employee contribution)" },
  { key: "esiMinor", codes: ["ESI", "ESIC"], label: "ESI (employee contribution)" },
  { key: "tdsMinor", codes: ["TDS", "INCOME_TAX", "IT"], label: "Income tax (TDS)" },
];

/** The three printed sections, with the deduction rows reconciled to the slip total. */
export function payslipSections(input: PayslipDocInput): { earnings: SlipRow[]; deductions: SlipRow[]; employer: SlipRow[] } {
  const comps = input.slip.components ?? [];
  const earnings = comps.filter((c) => c.type === "earning").map((c) => ({ label: c.name, amountMinor: toMinor(c.amountMinor) }));
  const deductions = comps.filter((c) => c.type === "deduction").map((c) => ({ label: c.name, amountMinor: toMinor(c.amountMinor) }));
  const codes = new Set(comps.filter((c) => c.type === "deduction").map((c) => c.code.toUpperCase()));
  for (const s of EMPLOYEE_STATUTORY) {
    const v = input.slip[s.key] as bigint;
    const label = s.key === "npsEmployeeMinor" && input.slip.isUps ? "UPS (employee contribution)" : s.label;
    if (v > 0n && !s.codes.some((c) => codes.has(c))) deductions.push({ label, amountMinor: v });
  }
  // The stored total is authoritative; anything it holds that no row names is shown, not hidden.
  const listed = deductions.reduce((a, d) => a + d.amountMinor, 0n);
  const gap = input.slip.totalDeductionsMinor - listed;
  if (gap > 0n) deductions.push({ label: "Other deductions", amountMinor: gap });
  const employer: SlipRow[] = [];
  if (input.slip.npsEmployerMinor > 0n) {
    employer.push(input.slip.isUps
      ? { label: "UPS (Government 10% + pool 8.5%)", amountMinor: input.slip.npsEmployerMinor + (input.slip.upsPoolMinor ?? 0n) }
      : { label: "NPS (employer contribution)", amountMinor: input.slip.npsEmployerMinor });
  }
  if (input.slip.pfEmployerMinor > 0n) employer.push({ label: "EPF + EPS (employer contribution)", amountMinor: input.slip.pfEmployerMinor });
  return { earnings, deductions, employer };
}

function payLevelText(e: PayslipDocInput["employee"]): string {
  const level = e.payLevel && e.payLevel > 0 ? `Level ${e.payLevel}` : "";
  if (level && e.payGrade) return `${level} (${e.payGrade})`;
  return level || e.payGrade || "";
}

/** "C2 — Senior Engineer"; the code alone when the name is blank. */
function gradeBandText(b: { code: string; name: string }): string {
  return b.name && b.name !== b.code ? `${b.code} \u2014 ${b.name}` : b.code;
}

export async function renderPayslipPdf(input: PayslipDocInput): Promise<Uint8Array> {
  const hi = input.lang === "hi";
  // Hindi-first when the slip is in Hindi; bilingual headings either way.
  const L = (en: string, h: string) => (hi ? `${h} / ${en}` : en);
  const H = (en: string, h: string) => (hi ? `${h} / ${en}` : `${en} / ${h}`);
  const period = input.month ? formatMonthYear(input.month, "en") : "";
  const periodHi = input.month ? formatMonthYear(input.month, "hi") : "";
  const e = input.employee;
  const { earnings, deductions, employer } = payslipSections(input);

  const pdf = await OfficialPdf.create({
    title: `Salary slip ${e.employeeNo} ${period}`.trim(),
    lang: hi ? "hi" : "bilingual",
    footerNote: `Salary slip · ${e.employeeNo}${period ? ` · ${period}` : ""}`,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
  });
  pdf.letterhead(input.issuer);
  pdf.title(period ? `Salary Slip for ${period}` : "Salary Slip", periodHi ? `वेतन पर्ची — ${periodHi}` : "वेतन पर्ची");
  pdf.fields([
    { label: L("Employee No", "कर्मचारी संख्या"), value: e.employeeNo },
    { label: L("Name", "नाम"), value: e.name },
    { label: L("Designation", "पदनाम"), value: e.designation ?? "" },
    // S8-G4: a tenant on private grade bands prints its band here instead of a (blank) 7th CPC pay level;
    // without a band the row is exactly what it always was.
    e.gradeBand
      ? { label: L("Grade Band", "ग्रेड बैंड"), value: gradeBandText(e.gradeBand) }
      : { label: L("Pay Level", "वेतन स्तर"), value: payLevelText(e) },
    { label: L("Department", "विभाग"), value: e.department ?? "" },
    { label: L("PAN", "पैन"), value: maskPanForPrint(e.pan) || "Not available" },
    { label: L("UAN", "यूएएन"), value: e.uan ?? "" },
    { label: L("Bank A/c", "बैंक खाता"), value: [maskAccountForPrint(e.bankAccount), e.bankIfsc].filter(Boolean).join(" · ") },
    ...(input.ddoName || input.ddoCode ? [{ label: L("DDO", "आहरण एवं संवितरण अधिकारी"), value: [input.ddoName, input.ddoCode].filter(Boolean).join(" · ") }] : []),
    { label: L("Pay period", "वेतन अवधि"), value: period },
  ]);

  const money = (r: SlipRow) => [r.label, formatMinorIndian(r.amountMinor)];
  pdf.heading(H("Earnings", "आय"));
  pdf.table({
    columns: [{ header: L("Component", "घटक"), width: 3 }, { header: L("Amount (₹)", "राशि (₹)"), width: 1, align: "right" }],
    rows: earnings.map(money),
    footRows: [[L("Gross Pay", "सकल वेतन"), formatMinorIndian(input.slip.grossMinor)]],
    emptyText: "No earnings recorded",
  });
  pdf.heading(H("Deductions", "कटौतियाँ"));
  pdf.table({
    columns: [{ header: L("Deduction", "कटौती"), width: 3 }, { header: L("Amount (₹)", "राशि (₹)"), width: 1, align: "right" }],
    rows: deductions.map(money),
    footRows: [[L("Total Deductions", "कुल कटौतियाँ"), formatMinorIndian(input.slip.totalDeductionsMinor)]],
    emptyText: "No deductions",
  });
  pdf.table({
    columns: [{ header: H("Net Pay", "निवल वेतन"), width: 3 }, { header: "₹", width: 1, align: "right" }],
    rows: [[L("Net amount credited", "खाते में जमा निवल राशि"), formatMinorIndian(input.slip.netPayMinor)]],
  });
  pdf.paragraph(`${L("In words", "शब्दों में")}: ${amountInWordsEn(input.slip.netPayMinor)}`, { bold: true });
  if (hi) pdf.paragraph(`शब्दों में: ${amountInWordsHi(input.slip.netPayMinor)}`, { bold: true });

  if (employer.length > 0) {
    pdf.heading(H("Employer contributions (not deducted from pay)", "नियोक्ता अंशदान (वेतन से नहीं काटा गया)"));
    pdf.table({
      columns: [{ header: L("Contribution", "अंशदान"), width: 3 }, { header: L("Amount (₹)", "राशि (₹)"), width: 1, align: "right" }],
      rows: employer.map(money),
    });
    pdf.note("Employer contributions are paid by the employer in addition to salary. They are not part of the deductions above and do not reduce net pay.");
  }

  if (input.showSignatureBlock && (input.signatoryTitle || input.ddoName)) {
    pdf.signatures([{ name: input.ddoName ?? input.signatoryTitle ?? "", designation: input.ddoName ? (input.signatoryTitle ?? null) : null }]);
  } else {
    pdf.space(6).note("This is a computer-generated salary slip and does not require a signature.");
  }
  return pdf.save();
}
