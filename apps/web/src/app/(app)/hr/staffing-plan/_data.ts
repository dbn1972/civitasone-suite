/**
 * hr/staffing-plan route loader + pure mapping helpers.
 *
 * Moved out of page.tsx (previously defined, and `departmentCadreLabel`/
 * `mapRows` exported, directly from it) because Next.js's App Router build
 * rejects any named export from a page.tsx other than its own small fixed
 * set (default, metadata, generateMetadata, route-segment config, etc.) --
 * page.test.tsx needs real imports of the two pure functions below, so they
 * can't just be private consts inside page.tsx. Same convention as the
 * other route groups' own _data.ts (e.g. cdp/_data.ts).
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatPercent, formatIndianDate } from "@/lib/formatters";

export type ApiRow = {
  id: string;
  department: string | null;
  cadre: string;
  sanctionedPosts: number;
  filled: number;
  vacant: number;
  fillPercentage: number | string;
  lastReview: string | null;
  planYear: number;
  status: string;
} & Record<string, unknown>;

export type Row = {
  id: string;
  departmentCadre: string;
  sanctionedPosts: number;
  filled: number;
  vacant: number;
  fillPercentage: string;
  lastReview: string;
  planYear: number;
  status: string;
} & Record<string, unknown>;

export type StaffingPlanPayload = {
  items: Row[];
  planYear: number | null;
  availableYears: number[];
};

/**
 * GAP-HR-STAFFING-PLAN-03: the column was labelled "Department / Cadre" but
 * only `department` was ever shown -- `cadre` was fetched and typed on the
 * row, but silently dropped on display, so two plans in the same
 * department with different cadres rendered as identical rows. Combined
 * into a single pre-formatted string here rather than a DataTable `render:`
 * column function, because this page is a Server Component and DataTable
 * ("use client") cannot receive a function prop across that boundary --
 * see scripts/ci/datatable-render-guard.mjs's own doc comment for the
 * exact crash class (GAP-HR-EXPENSES-01) this sidesteps.
 *
 * `department` is now `d.name` alone (nullable) rather than the backend's
 * old `COALESCE(d.name, p.cadre)` -- when there is no resolvable
 * department link, falling back to showing cadre alone (not "Cadre /
 * Cadre") avoids a redundant, confusing combined label.
 */
export function departmentCadreLabel(department: string | null, cadre: string): string {
  if (!department || department === cadre) return cadre;
  return `${department} / ${cadre}`;
}

export function mapRows(apiRows: ApiRow[]): Row[] {
  return apiRows.map((r) => ({
    ...r,
    // GAP-HR-STAFFING-PLAN-01: Postgres returns a `numeric` column as a
    // STRING over the wire via the postgres-js driver by default (e.g.
    // "87.5") -- formatPercent's Number.isFinite guard is false for a
    // string, so this always rendered '—' for every live row. Number(...)
    // coerces before formatting; the SQL side now also casts ::float8 so
    // the API contract is actually a number -- this is a defensive second
    // layer, not the only fix.
    fillPercentage: formatPercent(Number(r.fillPercentage), 1),
    // GAP-HR-STAFFING-PLAN-02: previously a raw, unformatted ISO datetime
    // string with no "—" fallback.
    lastReview: r.lastReview ? formatIndianDate(r.lastReview) : "—",
    departmentCadre: departmentCadreLabel(r.department, r.cadre),
  }));
}

export async function getData(year?: number): Promise<LoaderResult<StaffingPlanPayload>> {
  const qs = year ? `?year=${year}` : "";
  return fetchJson<unknown, StaffingPlanPayload>(`/api/v1/hrms/staffing-plan${qs}`, { items: [], planYear: null, availableYears: [] }, {
    telemetryKey: "hr.staffing-plan",
    mapResponse: (p) => {
      const payload = p as { data?: ApiRow[]; meta?: { planYear?: number; availableYears?: number[] } } | ApiRow[];
      const arr = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(arr)) return null;
      const meta = Array.isArray(payload) ? undefined : payload?.meta;
      return {
        items: mapRows(arr as ApiRow[]),
        planYear: meta?.planYear ?? null,
        availableYears: meta?.availableYears ?? [],
      };
    },
  });
}
