/**
 * Analytics screen loaders. Reuses the canonical API-only `fetchJson` (auth +
 * telemetry + error semantics) and maps the analytics service's paginated
 * envelopes to the row shapes the screens render. API-only: on failure the
 * screens fall back to the encrypted offline cache via useSeededResource.
 */
import { fetchJson, type LoaderResult } from "../../_data/apiClient";

export type AnalyticsDashboardRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  version: number;
};

export type AnalyticsResultRow = Record<string, string | number>;

export type AnalyticsQueryRunRow = {
  id: string;
  queryName: string;
  status: string;
  kind: string;
  metric: string;
  dimensions: string[];
  resultRows: number;
  rows: AnalyticsResultRow[];
  error: string | null;
};

type Paginated<T> = { data?: T[]; pagination?: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export async function getAnalyticsDashboards(): Promise<LoaderResult<AnalyticsDashboardRow[]>> {
  return fetchJson<Paginated<Record<string, unknown>>, AnalyticsDashboardRow[]>(
    "/api/v1/analytics/dashboards",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "analytics.dashboards.list",
      mapResponse: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
        return payload.data.filter(isRecord).map((d) => ({
          id: String(d.id ?? ""),
          name: String(d.name ?? "Untitled"),
          description: typeof d.description === "string" ? d.description : null,
          status: String(d.status ?? "active"),
          visibility: String(d.visibility ?? "private"),
          version: typeof d.version === "number" ? d.version : 1,
        }));
      },
    },
  );
}

export async function getAnalyticsQueryRuns(): Promise<LoaderResult<AnalyticsQueryRunRow[]>> {
  return fetchJson<Paginated<Record<string, unknown>>, AnalyticsQueryRunRow[]>(
    "/api/v1/analytics/queries",
    [],
    {
      revalidateSeconds: 15,
      telemetryKey: "analytics.queries.list",
      mapResponse: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
        return payload.data.filter(isRecord).map((r) => {
          const result = isRecord(r.result) ? r.result : {};
          const spec = isRecord(r.spec) ? r.spec : {};
          const rows = Array.isArray(result.rows) ? (result.rows as AnalyticsResultRow[]) : [];
          const dimensions = Array.isArray(spec.dimensions) ? (spec.dimensions as string[]) : [];
          return {
            id: String(r.id ?? ""),
            queryName: String(r.queryName ?? "query"),
            status: String(r.status ?? "running"),
            kind: String(r.kind ?? "adhoc"),
            metric: String(spec.metric ?? result.metric ?? "—"),
            dimensions,
            resultRows: typeof r.resultRows === "number" ? r.resultRows : rows.length,
            rows,
            error: typeof r.error === "string" ? r.error : null,
          };
        });
      },
    },
  );
}
