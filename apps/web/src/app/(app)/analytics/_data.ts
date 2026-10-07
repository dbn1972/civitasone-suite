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
  // GAP-ANALYTICS-DASHBOARDS-03: ownerId is returned by the API
  // (dashboardViewSchema.ownerId) but was dropped by the mapper, so a viewer
  // could not tell whose dashboard a row was. We surface the opaque owner id
  // (resolving it to a display name needs a cross-service call to identity and
  // is out of proportion here); null when the API omits it.
  ownerId: string | null;
};

export type AnalyticsResultRow = Record<string, string | number>;

/**
 * GAP-ANALYTICS-QUERIES-04: the unit a run's metric value is expressed in.
 * Money metrics (the `amount_*` family in the analytics registry) aggregate a
 * paise column, so their value is paise and must render as ₹ via the shared
 * paise→rupee formatter — never a bare integer. Everything else is a plain
 * count. Derived from the metric key (the single whitelisted vocabulary shared
 * with services/analytics-service registry.ts) so the list endpoint needn't be
 * joined against the catalog per row.
 */
export type MetricUnit = "paise" | "count";

export function unitForMetric(metricKey: string): MetricUnit {
  return metricKey.startsWith("amount_") ? "paise" : "count";
}

export type AnalyticsQueryRunRow = {
  id: string;
  queryName: string;
  status: string;
  kind: string;
  metric: string;
  metricUnit: MetricUnit;
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
          // GAP-ANALYTICS-DASHBOARDS-03: do NOT silently default a missing
          // visibility to "private" — that hid a mapping gap behind a
          // plausible-looking value. Surface "unknown" instead so a missing
          // field is visibly a gap, not a (possibly wrong) access claim.
          visibility: typeof d.visibility === "string" && d.visibility ? d.visibility : "unknown",
          version: typeof d.version === "number" ? d.version : 1,
          ownerId: typeof d.ownerId === "string" ? d.ownerId : null,
        }));
      },
    },
  );
}

// GAP-ANALYTICS-DASHBOARDS-01: detail view. The analytics service already
// exposes GET /api/v1/analytics/dashboards/:id (access-controlled: returns 404
// when the caller may not view it), so this is a straight wire-up — no new
// backend. The response is the detail object itself (not a {data} envelope;
// see sendValidated in @civitasone/schemas).
export type AnalyticsDashboardWidget = {
  id: string;
  title: string;
  vizType: string;
  position: number;
};

export type AnalyticsDashboardDetail = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  ownerId: string | null;
  version: number;
  widgets: AnalyticsDashboardWidget[];
  shareCount: number;
};

export async function getAnalyticsDashboardById(
  id: string,
): Promise<LoaderResult<AnalyticsDashboardDetail | null>> {
  return fetchJson<Record<string, unknown>, AnalyticsDashboardDetail | null>(
    `/api/v1/analytics/dashboards/${encodeURIComponent(id)}`,
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "analytics.dashboards.detail",
      mapResponse: (payload) => {
        if (!isRecord(payload) || typeof payload.id !== "string") return null;
        const widgets = Array.isArray(payload.widgets)
          ? payload.widgets.filter(isRecord).map((w) => ({
              id: String(w.id ?? ""),
              title: String(w.title ?? "Untitled widget"),
              vizType: String(w.vizType ?? "table"),
              position: typeof w.position === "number" ? w.position : 0,
            }))
          : [];
        const shareCount = Array.isArray(payload.shares) ? payload.shares.length : 0;
        return {
          id: payload.id,
          name: String(payload.name ?? "Untitled"),
          description: typeof payload.description === "string" ? payload.description : null,
          status: String(payload.status ?? "active"),
          visibility:
            typeof payload.visibility === "string" && payload.visibility ? payload.visibility : "unknown",
          ownerId: typeof payload.ownerId === "string" ? payload.ownerId : null,
          version: typeof payload.version === "number" ? payload.version : 1,
          widgets: widgets.sort((a, b) => a.position - b.position),
          shareCount,
        };
      },
    },
  );
}

export async function getAnalyticsQueryRuns(): Promise<LoaderResult<AnalyticsQueryRunRow[]>> {  return fetchJson<Paginated<Record<string, unknown>>, AnalyticsQueryRunRow[]>(
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
          const metric = String(spec.metric ?? result.metric ?? "—");
          return {
            id: String(r.id ?? ""),
            queryName: String(r.queryName ?? "query"),
            status: String(r.status ?? "running"),
            kind: String(r.kind ?? "adhoc"),
            metric,
            metricUnit: unitForMetric(metric),
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
