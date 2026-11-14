/**
 * M9: the salary journals payroll hands to a tenant that has no Finance module.
 *
 * Pure. The accrual lines are the SAME lines finance-service builds on
 * payroll.run.approved (integrations/payroll-accrual.ts payrollAccrualLines +
 * payroll-deductions.ts deductionLines) and the settlement is the pair it builds
 * on payroll.run.disbursed (gl/consumer.ts). That equivalence is pinned by
 * tests/contract/payroll-journal-export.contract.test.ts, which feeds both
 * builders the same payload, so the two cannot drift apart unnoticed.
 *
 * Money stays bigint paise; a rupee figure is only ever rendered from paise.
 */

export type DeductionKind = "tds" | "gpf" | "nps" | "pf" | "esi" | "pt" | "other";
const DEDUCTION_ORDER: DeductionKind[] = ["tds", "gpf", "nps", "pf", "esi", "pt", "other"];
const DEDUCTION_NARRATION: Record<DeductionKind, string> = {
  tds: "Income tax deducted at source (salary) payable", gpf: "GPF subscriptions payable", nps: "NPS employee contributions payable",
  pf: "EPF employee contributions payable", esi: "ESI employee contributions payable", pt: "Professional tax payable",
  other: "Other salary deductions payable (LIC / others)",
};

/** Account codes: the same defaults and env overrides as finance-service (gl/system-heads.ts, gl/consumer.ts). */
export function deductionHeads(env: NodeJS.ProcessEnv = process.env): Record<DeductionKind, string> {
  const pick = (k: string, d: string) => env[k]?.trim() || d;
  return {
    tds: pick("PAYROLL_GL_TDS_HEAD", env.FINANCE_TDS_PAYABLE_CODE?.trim() || "2200"),
    gpf: pick("PAYROLL_GL_GPF_HEAD", "2104"),
    nps: pick("PAYROLL_GL_NPS_HEAD", "2105"),
    pf: pick("PAYROLL_GL_EPF_HEAD", "2106"),
    esi: pick("PAYROLL_GL_ESI_HEAD", "2107"),
    pt: pick("PAYROLL_GL_PT_HEAD", "2108"),
    other: pick("PAYROLL_GL_OTHER_DEDUCTIONS_HEAD", "2102"),
  };
}

export const SALARY_EXPENSE_HEAD = "5001";
export const NET_PAYABLE_HEAD_DEFAULT = "2101";
export const BANK_HEAD_DEFAULT = "1101";
export const EMPLOYER_EXPENSE_HEAD = "5002";
export const EMPLOYER_PAYABLE_HEAD = "2103";

export type JournalLine = { accountCode: string; debitMinor: bigint; creditMinor: bigint; narration: string };

export interface AccrualInput {
  totalGrossMinor: bigint;
  totalNetMinor: bigint;
  totalEmployerContribMinor: bigint;
  edliMinor: bigint;
  epfAdminMinor: bigint;
  upsPoolMinor: bigint;
  /** gross - net split by type (paise); used only when the parts add up to gross - net. */
  employeeDeductionsMinor?: Partial<Record<DeductionKind, bigint | string>> | undefined;
}

function deductionLines(statutory: bigint, breakdown: AccrualInput["employeeDeductionsMinor"], heads: Record<DeductionKind, string>): JournalLine[] {
  const leg = (code: string, v: bigint, narration: string): JournalLine =>
    v >= 0n ? { accountCode: code, debitMinor: 0n, creditMinor: v, narration } : { accountCode: code, debitMinor: -v, creditMinor: 0n, narration };
  if (breakdown) {
    const parts = DEDUCTION_ORDER.map((k) => [k, BigInt(breakdown[k] ?? "0")] as const);
    if (parts.reduce((acc, [, v]) => acc + v, 0n) === statutory) {
      const lines = parts.filter(([, v]) => v !== 0n).map(([k, v]) => leg(heads[k], v, DEDUCTION_NARRATION[k]));
      return lines.length > 0 ? lines : [leg(heads.other, 0n, DEDUCTION_NARRATION.other)];
    }
  }
  return [leg("2102", statutory, "Statutory deductions payable")];
}

function employerPair(lines: JournalLine[], amount: bigint, expense: string, payable: string): void {
  if (amount <= 0n) return;
  lines.push({ accountCode: EMPLOYER_EXPENSE_HEAD, debitMinor: amount, creditMinor: 0n, narration: expense });
  lines.push({ accountCode: EMPLOYER_PAYABLE_HEAD, debitMinor: 0n, creditMinor: amount, narration: payable });
}

/** The salary accrual journal: Dr salary expense / Cr net payable, deductions, employer contributions. */
export function accrualJournalLines(i: AccrualInput, env: NodeJS.ProcessEnv = process.env): JournalLine[] {
  const statutory = i.totalGrossMinor - i.totalNetMinor;
  const lines: JournalLine[] = [
    { accountCode: SALARY_EXPENSE_HEAD, debitMinor: i.totalGrossMinor, creditMinor: 0n, narration: "Salary expense" },
    { accountCode: NET_PAYABLE_HEAD_DEFAULT, debitMinor: 0n, creditMinor: i.totalNetMinor, narration: "Net salary payable" },
    ...deductionLines(statutory, i.employeeDeductionsMinor, deductionHeads(env)),
  ];
  employerPair(lines, i.totalEmployerContribMinor, "Employer contributions expense", "Employer contributions payable");
  employerPair(lines, i.edliMinor, "Employer EDLI contribution (EPFO A/c 21)", "EDLI contribution payable to EPFO (A/c 21)");
  employerPair(lines, i.epfAdminMinor, "EPF administrative charges (EPFO A/c 2)", "EPF administrative charges payable to EPFO (A/c 2)");
  employerPair(lines, i.upsPoolMinor, "Government UPS pool corpus contribution (8.5%)", "UPS pool corpus contribution payable");
  return lines;
}

/** The settlement journal on disbursement: Dr net payable / Cr bank. Empty for a run with nothing to pay. */
export function settlementJournalLines(netMinor: bigint, env: NodeJS.ProcessEnv = process.env): JournalLine[] {
  if (netMinor <= 0n) return [];
  return [
    { accountCode: env["PAYROLL_GL_NET_PAYABLE_HEAD"] ?? NET_PAYABLE_HEAD_DEFAULT, debitMinor: netMinor, creditMinor: 0n, narration: "Net salary paid: payable cleared" },
    { accountCode: env["PAYROLL_GL_BANK_HEAD"] ?? BANK_HEAD_DEFAULT, debitMinor: 0n, creditMinor: netMinor, narration: "Net salary paid: bank" },
  ];
}

export type JournalStage = "accrual" | "disbursement";

/** Same voucher numbers finance would use (PAY/ for the accrual, PAYSTL/ for the settlement). */
export function voucherNo(stage: JournalStage, run: { id: string; month: string }): string {
  return stage === "accrual"
    ? `PAY/${run.month}/${run.id.slice(0, 8)}`
    : `PAYSTL/${run.month}/${run.id.slice(0, 8).toUpperCase()}`;
}

export function isBalanced(lines: ReadonlyArray<{ debitMinor: bigint; creditMinor: bigint }>): boolean {
  return lines.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0n) === 0n;
}

/** Last calendar day of a YYYY-MM pay month. */
export function payMonthEndDate(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Paise to a plain rupee string with exactly two decimals (no float). */
export function rupees(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export interface StoredJournal {
  stage: JournalStage;
  voucherNo: string;
  /** YYYY-MM-DD: pay-month end for the accrual, the IST payment date for the settlement. */
  postingDate: string;
  month: string;
  runId: string;
  lines: JournalLine[];
}

const csvCell = (v: string): string => {
  // A leading = + - @ would be run as a formula by a spreadsheet; narrations are ours, but stay safe.
  const safe = /^[=+@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const CSV_HEADER = ["Voucher No", "Posting Date", "Voucher Type", "Account Code", "Debit (INR)", "Credit (INR)", "Narration", "Pay Month", "Payroll Run"];

/** One CSV for one or both stages. Debit and credit are rupee strings rendered from paise. */
export function journalsToCsv(journals: readonly StoredJournal[]): string {
  const rows = [CSV_HEADER.join(",")];
  for (const j of journals) {
    const type = j.stage === "accrual" ? "payroll_accrual" : "payroll_settlement";
    for (const l of j.lines) {
      rows.push([
        j.voucherNo, j.postingDate, type, l.accountCode,
        l.debitMinor === 0n ? "" : rupees(l.debitMinor), l.creditMinor === 0n ? "" : rupees(l.creditMinor),
        l.narration, j.month, j.runId,
      ].map(csvCell).join(","));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tallyDate = (d: string): string => d.replace(/-/g, "");

/**
 * Tally Prime / ERP 9 import XML (Import Data > Vouchers). Ledger names are the
 * account code, so a ledger of that name must exist in Tally. Debit entries are
 * ISDEEMEDPOSITIVE=Yes with a negative amount, credit entries No with a positive
 * one (Tally's sign convention).
 */
export function journalsToTallyXml(journals: readonly StoredJournal[], companyName?: string): string {
  const vouchers = journals.map((j) => {
    const entries = j.lines.map((l) => {
      const debit = l.debitMinor > 0n;
      const amount = debit ? `-${rupees(l.debitMinor)}` : rupees(l.creditMinor);
      return [
        "      <ALLLEDGERENTRIES.LIST>",
        `        <LEDGERNAME>${xml(l.accountCode)}</LEDGERNAME>`,
        `        <ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
        `        <AMOUNT>${amount}</AMOUNT>`,
        "      </ALLLEDGERENTRIES.LIST>",
      ].join("\n");
    }).join("\n");
    return [
      "    <TALLYMESSAGE xmlns:UDF=\"TallyUDF\">",
      "      <VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\">",
      `        <DATE>${tallyDate(j.postingDate)}</DATE>`,
      "        <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>",
      `        <VOUCHERNUMBER>${xml(j.voucherNo)}</VOUCHERNUMBER>`,
      `        <NARRATION>${xml(`Payroll ${j.month} ${j.stage === "accrual" ? "accrual" : "settlement"} (run ${j.runId})`)}</NARRATION>`,
      entries,
      "      </VOUCHER>",
      "    </TALLYMESSAGE>",
    ].join("\n");
  }).join("\n");
  return [
    "<ENVELOPE>",
    "  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    "  <BODY>",
    "    <IMPORTDATA>",
    "      <REQUESTDESC>",
    "        <REPORTNAME>Vouchers</REPORTNAME>",
    `        <STATICVARIABLES>${companyName ? `<SVCURRENTCOMPANY>${xml(companyName)}</SVCURRENTCOMPANY>` : ""}</STATICVARIABLES>`,
    "      </REQUESTDESC>",
    "      <REQUESTDATA>",
    vouchers,
    "      </REQUESTDATA>",
    "    </IMPORTDATA>",
    "  </BODY>",
    "</ENVELOPE>",
    "",
  ].join("\n");
}
