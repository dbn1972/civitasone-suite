import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * GAP-PAYROLL-STATUTORY-PF-03 / ESI-03: server-side loader for the PF and ESI
 * ledger pages. The stat tiles come from payroll-service's
 * `GET /v1/payroll/statutory/<pf|esi>/summary` (COUNT/SUM in SQL over every
 * row of the period, plus the distinct period list for the picker), and the
 * table from `GET /v1/payroll/statutory/<pf|esi>?period=...&limit=500`. The
 * totals therefore never depend on a list page size; the table says so when
 * it shows fewer rows than the period has.
 *
 * Server-only: imports the server apiClient. Do not import from a
 * "use client" component.
 */
export const LEDGER_PAGE_LIMIT = 500;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type LedgerSummary = {
  periods: string[];
  period: string | null;
  recordCount: number;
  empContribMinor: string;
  erContribMinor: string;
  totalContribMinor: string;
};

function asSummary(p: unknown): LedgerSummary | null {
  const s = (p && typeof p === "object" && "data" in (p as object) && !Array.isArray(p)
    ? (p as { data?: unknown }).data ?? p
    : p) as Partial<LedgerSummary> | null;
  if (!s || typeof s !== "object" || !Array.isArray(s.periods)) return null;
  return {
    periods: s.periods.filter((x): x is string => typeof x === "string"),
    period: typeof s.period === "string" ? s.period : null,
    recordCount: Number(s.recordCount ?? 0),
    empContribMinor: String(s.empContribMinor ?? "0"),
    erContribMinor: String(s.erContribMinor ?? "0"),
    totalContribMinor: String(s.totalContribMinor ?? "0"),
  };
}

export type LedgerPeriodResult<Row> = {
  source: LoaderResult<unknown>["source"];
  summary: LedgerSummary | null;
  rows: Row[];
  /** True when the period has more rows than the table received. */
  truncated: boolean;
};

export async function loadLedgerPeriod<Row>(kind: "pf" | "esi", requested?: string): Promise<LedgerPeriodResult<Row>> {
  const period = requested && PERIOD_RE.test(requested) ? requested : undefined;
  const summaryRes = await fetchJson<unknown, LedgerSummary | null>(
    `/api/v1/payroll/statutory/${kind}/summary${period ? `?period=${encodeURIComponent(period)}` : ""}`,
    null,
    { telemetryKey: `payroll.statutory.${kind}.summary`, mapResponse: asSummary },
  );
  const summary = summaryRes.source === "error" ? null : asSummary(summaryRes.data);
  if (!summary) return { source: "error", summary: null, rows: [], truncated: false };
  if (!summary.period) return { source: summaryRes.source, summary, rows: [], truncated: false };

  const rowsRes = await fetchJson<unknown, Row[]>(
    `/api/v1/payroll/statutory/${kind}?period=${encodeURIComponent(summary.period)}&limit=${LEDGER_PAGE_LIMIT}`,
    [],
    {
      telemetryKey: `payroll.statutory.${kind}`,
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );
  const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];
  return {
    source: rowsRes.source,
    summary,
    rows,
    truncated: rowsRes.source !== "error" && rows.length < summary.recordCount,
  };
}
