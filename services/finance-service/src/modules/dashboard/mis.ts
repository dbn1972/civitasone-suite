/**
 * GAP-FINANCE-DASHBOARD-06 — the MIS deliverable behind "Export MIS": a CSV of
 * the dashboard's figures for one fiscal year. Pure (no DB, no HTTP).
 */

export type MisDashboard = {
  budgetUtilisationPct: number | null;
  pendingSanctions: number;
  paymentsThisMonth: number;
  totalExpenditure: number;
  sanctionedMinor?: string;
};

/** Paise (bigint-safe) as a rupee decimal string, e.g. 12345n -> "123.45". */
export function paiseToRupeesString(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

function csvCell(v: string): string {
  // Defuse spreadsheet formula injection, then quote when needed.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function misFileName(fy: string): string {
  return `finance-mis-${fy}.csv`;
}

export function buildMisCsv(fy: string, d: MisDashboard, generatedAtIso: string): string {
  const rows: string[][] = [
    ["Section", "Metric", "Value", "Unit"],
    ["Report", "Fiscal year", fy, ""],
    ["Report", "Generated at (UTC)", generatedAtIso, ""],
    [
      "Budget", "Budget utilisation",
      d.budgetUtilisationPct === null ? "" : String(d.budgetUtilisationPct), "percent",
    ],
    [
      "Budget", "Budget estimate (BE)",
      d.sanctionedMinor === undefined ? "" : paiseToRupeesString(BigInt(d.sanctionedMinor)), "INR",
    ],
    ["Expenditure", "Expenditure (FY to date)", paiseToRupeesString(BigInt(Math.trunc(d.totalExpenditure))), "INR"],
    ["Payments", "Payments this month", String(d.paymentsThisMonth), "count"],
    ["Approvals", "Pending sanctions", String(d.pendingSanctions), "count"],
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
