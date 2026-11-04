/** EPFO statutory ceiling on pensionable wages (rupees). */
export const EPF_WAGE_CEILING = 15000;

/**
 * EPFO pensionable wage = Basic + DA, capped at the Rs 15,000 ceiling
 * (EPF Scheme para 29 read with the 2014 amendment ceiling).
 * Basic alone under-states the wage for every employee with a DA component
 * and gets the ECR challan rejected (PAY-DEF01).
 */
export function computePensionableWage(basicWages: number, daWages: number): number {
  return Math.min(basicWages + daWages, EPF_WAGE_CEILING);
}

/**
 * EPFO ECR 2.0 text upload (Unified Portal, Employer e-Sewa > Payments >
 * "ECR Upload", ECR version 2.0 text file format). UAT b18 D4: the file used
 * to be pipe-separated, which the portal rejects. Each member is one line of
 * exactly 11 fields separated by the three-character sequence "#~#", no header
 * row, in this order:
 *   1 UAN  2 Member Name  3 Gross Wages  4 EPF Wages  5 EPS Wages  6 EDLI Wages
 *   7 EPF Contribution remitted (EE share)  8 EPS Contribution remitted (ER)
 *   9 EPF-EPS Difference remitted (ER share)  10 NCP Days  11 Refund of Advances
 * Amounts are whole rupees, NCP days a whole number of days. This repository
 * documents no other (authoritative) ECR spec; the previous pipe layout had
 * the same 11 columns in the same order, so only the separator changed.
 */
export const ECR_FIELD_SEPARATOR = "#~#";
export const ECR_LINE_SEPARATOR = "\r\n";

export interface EcrMemberLine {
  uan: string;
  memberName: string;
  grossWages: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfContributionEe: number;
  epsContributionEr: number;
  epfEpsDiffEr: number;
  ncpDays: number;
  refundOfAdvances: number;
}

/** A UAN is exactly 12 digits (EPFO Universal Account Number). */
export function isValidUan(uan: string | null | undefined): boolean {
  return typeof uan === "string" && /^\d{12}$/.test(uan.trim());
}

/**
 * Free text must never carry the separator or a line break: strip "#", "~",
 * CR and LF (H4 -- a crafted name cannot inject or misalign a record) and
 * collapse the whitespace left behind.
 */
export function ecrText(v: string | null | undefined): string {
  return (v ?? "").replace(/[#~\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

function wholeNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.max(0, Math.round(n)));
}

/** One ECR 2.0 member line (fields in the order above). */
export function formatEcrLine(m: EcrMemberLine): string {
  return [
    ecrText(m.uan),
    ecrText(m.memberName),
    wholeNumber(m.grossWages),
    wholeNumber(m.epfWages),
    wholeNumber(m.epsWages),
    wholeNumber(m.edliWages),
    wholeNumber(m.epfContributionEe),
    wholeNumber(m.epsContributionEr),
    wholeNumber(m.epfEpsDiffEr),
    wholeNumber(m.ncpDays),
    wholeNumber(m.refundOfAdvances),
  ].join(ECR_FIELD_SEPARATOR);
}

/** The whole ECR 2.0 file body: one line per member, CRLF between lines, no header. */
export function buildEcrFile(members: EcrMemberLine[]): string {
  return members.map(formatEcrLine).join(ECR_LINE_SEPARATOR);
}

export interface EcrUanProblem {
  employeeId: string;
  employeeNo: string | null;
  problem: "missing" | "invalid";
}

/**
 * UAT b18 D3: EPF members whose UAN is missing or not 12 digits. The ECR is
 * refused while any exist -- a blank or malformed UAN is rejected by EPFO, and
 * a file that silently drops the member under-remits.
 */
export function uanProblems(members: Array<{ employeeId: string; employeeNo: string | null; uan: string | null | undefined }>): EcrUanProblem[] {
  const out: EcrUanProblem[] = [];
  for (const m of members) {
    const raw = (m.uan ?? "").trim();
    if (raw === "") out.push({ employeeId: m.employeeId, employeeNo: m.employeeNo, problem: "missing" });
    else if (!isValidUan(raw)) out.push({ employeeId: m.employeeId, employeeNo: m.employeeNo, problem: "invalid" });
  }
  return out;
}

/** NCP (non-contributing) days for the month: the loss-of-pay days on the slip, rounded to whole days. */
export function ncpDaysFromComponents(components: Array<{ code: string; lopDays?: number | string | null }>): number {
  const days = components
    .filter((c) => c.code === "LOP" && c.lopDays != null)
    .reduce((s, c) => s + Number(c.lopDays), 0);
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 0;
}
