import { toMinorBigInt } from "@/lib/payroll/money";

/** One side of GET /v1/payroll/comparison. gross/net are PAISE (BIGINT as integer string). */
export type PeriodSummary = {
  period: string;
  gross: number | string;
  net: number | string;
  headcount: number;
  /**
   * payroll-service sets this false when payroll.payroll_register has no
   * rows for the period (it otherwise COALESCEs to zeros, which would read
   * as a real ₹0 payroll). Absent on older responses.
   */
  hasData?: boolean;
};

/** GAP-PAYROLL-COMPARISON-02: a missing side is null, not a failed load. */
export type CompareData = { period1: PeriodSummary | null; period2: PeriodSummary | null };

function isSummary(v: unknown): v is PeriodSummary {
  return !!v && typeof v === "object" && typeof (v as PeriodSummary).period === "string";
}

/** Treat an explicit hasData:false -- or, on an older backend, an all-zero summary -- as "no data". */
function present(s: PeriodSummary): PeriodSummary | null {
  if (s.hasData === false) return null;
  if (s.hasData === undefined && Number(s.headcount) === 0 && toMinorBigInt(s.gross) === 0n && toMinorBigInt(s.net) === 0n) {
    return null;
  }
  return s;
}

export function mapComparisonResponse(p: unknown): CompareData | null {
  const body = p as { period1?: unknown; period2?: unknown } | null;
  // Only a body with neither side in a recognisable shape is malformed.
  if (!body || typeof body !== "object" || (!isSummary(body.period1) && !isSummary(body.period2))) return null;
  return {
    period1: isSummary(body.period1) ? present(body.period1) : null,
    period2: isSummary(body.period2) ? present(body.period2) : null,
  };
}
