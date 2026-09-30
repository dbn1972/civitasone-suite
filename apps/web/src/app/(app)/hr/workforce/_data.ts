import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * Shared loaders/mappers for `/hr/workforce` and `/hr/workforce/analytics`.
 *
 * GAP-HR-WORKFORCE-01/02/04/06 + GAP-HR-WORKFORCE-ANALYTICS-01/02/03/04: both
 * pages load headcount and the retirement forecast from the same
 * hrms-service module and had the SAME response-shape bugs (headcount's
 * `{data:{total,breakdown}}` was read as a bare array; the retirement
 * forecast's `{period, retiring_count}` rows were read as if they were
 * `{fullName, monthsLeft}` officer rows). Extracted here once instead of
 * fixed twice in two files that would otherwise drift again.
 */

export type GroupBy = "department" | "grade" | "type";

export type HeadcountRow = { group_key: string; count: number } & Record<string, unknown>;

export type RetirementRow = { period: string; retiring_count: number } & Record<string, unknown>;

export type VacancyHorizon = "1_year" | "3_years" | "5_years" | "beyond_5_years";
export type VacancyRow = { horizon: VacancyHorizon; count: number } & Record<string, unknown>;

export interface AnalyticsKpis {
  avgTenureYears: number | null;
  /** Omitted by the backend entirely (not `0`) when the tenant's total is below the suppression threshold. */
  genderRatioF?: number;
  genderRatioM?: number;
  /**
   * Never populated by the backend today (see GAP-HR-WORKFORCE-ANALYTICS-01:
   * needs cross-module attendance/lifecycle history with no read model yet).
   * Declared here, always-optional, purely so the trend chart's existing
   * "not yet available" empty state (and its GAP-HR-WORKFORCE-ANALYTICS-05
   * zero-baseline fix) stay real, reachable, testable code for whenever a
   * future PR adds a genuine cross-module read model for this.
   */
  monthlyTrend?: { month: string; headcount: number }[];
}

export interface AnalyticsKpisMeta {
  genderSuppressed: boolean;
  genderSuppressionThreshold: number;
  /** Named KPIs the backend deliberately does not compute yet -- see GAP-HR-WORKFORCE-ANALYTICS-01. */
  unavailable: string[];
}

const EMPTY_KPIS: AnalyticsKpis = { avgTenureYears: null };
const EMPTY_KPIS_META: AnalyticsKpisMeta = {
  genderSuppressed: true,
  genderSuppressionThreshold: 10,
  unavailable: ["turnoverPct", "absenteeismPct", "monthlyTrend"],
};

export async function getHeadcount(groupBy: GroupBy = "department"): Promise<LoaderResult<HeadcountRow[]>> {
  return fetchJson<unknown, HeadcountRow[]>(`/api/v1/hrms/workforce/headcount?groupBy=${groupBy}`, [], {
    telemetryKey: "hr.workforce.headcount",
    mapResponse: (p) => {
      // GAP-HR-WORKFORCE-01: the real payload is `{data:{total,breakdown}}`,
      // never a bare array and never `{data:[...]}` -- both of which this
      // used to accept, silently mapping the object form to `null` (an
      // "error", even against a perfectly healthy backend).
      const body = p as { data?: { breakdown?: unknown } } | null;
      const breakdown = body?.data?.breakdown;
      return Array.isArray(breakdown) ? (breakdown as HeadcountRow[]) : null;
    },
  });
}

/**
 * GAP-HR-WORKFORCE-01/GAP-HR-WORKFORCE-ANALYTICS-03: the real payload is
 * `{data: [{period, retiring_count}]}` grouped by month/quarter/year -- there
 * is no per-officer identity in it at all (see the WORKFORCE-05-refuted note:
 * adding one would recreate that exact DPDP risk). `years=1` at `month`
 * granularity is exactly enough to cover both the 6- and 12-month stat cards
 * below.
 */
export async function getRetirements(years = 1): Promise<LoaderResult<RetirementRow[]>> {
  return fetchJson<unknown, RetirementRow[]>(
    `/api/v1/hrms/workforce/retirement-forecast?granularity=month&years=${years}`,
    [],
    {
      telemetryKey: "hr.workforce.retirement",
      mapResponse: (p) => {
        const arr = (p as { data?: unknown })?.data;
        return Array.isArray(arr) ? (arr as RetirementRow[]) : null;
      },
    },
  );
}

export async function getRetirementAgeMeta(): Promise<number | null> {
  const result = await fetchJson<unknown, number | null>(
    "/api/v1/hrms/workforce/retirement-forecast?granularity=month&years=1",
    null,
    {
      telemetryKey: "hr.workforce.retirement.meta",
      mapResponse: (p) => {
        const age = (p as { meta?: { retirementAge?: unknown } })?.meta?.retirementAge;
        return typeof age === "number" ? age : null;
      },
    },
  );
  return result.data;
}

export async function getVacancyForecast(): Promise<LoaderResult<VacancyRow[]>> {
  return fetchJson<unknown, VacancyRow[]>("/api/v1/hrms/workforce/vacancy-forecast", [], {
    telemetryKey: "hr.workforce.vacancy-forecast",
    mapResponse: (p) => {
      const arr = (p as { data?: unknown })?.data;
      return Array.isArray(arr) ? (arr as VacancyRow[]) : null;
    },
  });
}

export async function getAnalyticsKpis(): Promise<LoaderResult<AnalyticsKpis> & { meta: AnalyticsKpisMeta }> {
  let meta: AnalyticsKpisMeta = EMPTY_KPIS_META;
  const result = await fetchJson<unknown, AnalyticsKpis>(
    "/api/v1/hrms/workforce/analytics-kpis",
    EMPTY_KPIS,
    {
      telemetryKey: "hr.workforce.analytics-kpis",
      mapResponse: (p) => {
        const body = p as { data?: unknown; meta?: Partial<AnalyticsKpisMeta> } | null;
        if (!body || typeof body.data !== "object" || body.data === null) return null;
        if (body.meta) meta = { ...EMPTY_KPIS_META, ...body.meta };
        return body.data as AnalyticsKpis;
      },
    },
  );
  return { ...result, meta: result.source === "error" ? EMPTY_KPIS_META : meta };
}

/**
 * "Today" in IST, truncated to the calendar month, for comparing against
 * `retirement-forecast`'s `granularity=month` period labels ("YYYY-MM").
 *
 * Deliberately a small local helper rather than importing a shared one: an
 * unrelated, already-open PR (GAP-HR-SF-07, "formatIndianDateTime +
 * todayIST/addDaysIST") adds a shared export of this exact name to
 * `@/lib/formatters`. Adding a second one here now would guarantee a
 * same-name-same-file merge conflict between the two PRs (same rationale as
 * DataTable.tsx's own local `formatDateTimeIST`). Once SF-07 lands, a
 * follow-up can delete this and switch to the shared helper.
 */
export function currentPeriodMonthIST(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/**
 * Sum of `retiring_count` for periods within `maxMonthsExclusive` calendar
 * months of the current month (inclusive of the current month itself, i.e.
 * offset 0..maxMonthsExclusive-1) -- e.g. `withinMonths=6` sums the current
 * month plus the next 5. Non-`YYYY-MM` periods (a caller using
 * `granularity=quarter`/`year`) are ignored rather than mis-parsed.
 */
export function sumRetiringWithinMonths(
  rows: RetirementRow[],
  maxMonthsExclusive: number,
  from: { year: number; month: number } = currentPeriodMonthIST(),
): number {
  return rows.reduce((sum, r) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(r.period));
    if (!m) return sum;
    const periodYear = Number(m[1]);
    const periodMonth = Number(m[2]);
    const offset = (periodYear - from.year) * 12 + (periodMonth - from.month);
    if (offset >= 0 && offset < maxMonthsExclusive) return sum + Number(r.retiring_count ?? 0);
    return sum;
  }, 0);
}

export const VACANCY_HORIZON_ORDER: VacancyHorizon[] = ["1_year", "3_years", "5_years"];
