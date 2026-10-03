/**
 * GAP-FINANCE-STATUTORY-TDS-RETURNS-04: quarterly TDS return filing register
 * (GET /v1/finance/tds-returns?fy=). One row per quarter of the FY. Money is bigint
 * paise carried as strings.
 */
export type TdsFilingStatus = "filed" | "pending" | "overdue";

export type TdsFiling = {
  fy: string;
  quarter: string;
  formType: string;
  dueDate: string;
  status: TdsFilingStatus;
  ackNo: string | null;
  filedOn: string | null;
  filedByName: string | null;
  deductionCount: number;
  totalTdsMinor: string;
  undepositedCount: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function mapTdsFilings(payload: unknown): TdsFiling[] | null {
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : null;
  if (!rows) return null;
  const out: TdsFiling[] = [];
  for (const r of rows) {
    if (!isRecord(r) || typeof r.quarter !== "string" || typeof r.dueDate !== "string") continue;
    const status: TdsFilingStatus = r.status === "filed" || r.status === "overdue" ? r.status : "pending";
    out.push({
      fy: str(r.fy),
      quarter: r.quarter,
      formType: str(r.formType, "26Q"),
      dueDate: r.dueDate,
      status,
      ackNo: strOrNull(r.ackNo),
      filedOn: strOrNull(r.filedOn),
      filedByName: strOrNull(r.filedByName),
      deductionCount: num(r.deductionCount),
      totalTdsMinor: str(r.totalTdsMinor, "0"),
      undepositedCount: num(r.undepositedCount),
    });
  }
  return out;
}

/** Mirrors finance-service assertValidAckNo: 6-32 letters or digits. */
export function validAckNo(v: string): boolean {
  return /^[A-Za-z0-9]{6,32}$/.test(v.trim());
}

/** Mirrors the quarter-end rule: a return can be recorded only after its quarter ended, never in the future. */
export function quarterEnd(fy: string, quarter: string): string | null {
  const m = /^(\d{4})-\d{2}$/.exec(fy);
  if (!m) return null;
  const y = Number(m[1]);
  switch (quarter) {
    case "Q1": return `${y}-06-30`;
    case "Q2": return `${y}-09-30`;
    case "Q3": return `${y}-12-31`;
    case "Q4": return `${y + 1}-03-31`;
    default: return null;
  }
}

export function validFilingDate(fy: string, quarter: string, filedOn: string, todayIso: string): "ok" | "format" | "future" | "early" {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn)) return "format";
  if (filedOn > todayIso) return "future";
  const end = quarterEnd(fy, quarter);
  return end !== null && filedOn <= end ? "early" : "ok";
}
