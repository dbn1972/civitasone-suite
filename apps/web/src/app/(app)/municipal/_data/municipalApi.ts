import { fetchJson } from "@/app/_data/apiClient";
import type { MunicipalServiceConfig } from "./services";
import { detailPathFor } from "./services";
import {
  parseDetailPayload,
  parseListPayload,
  toMunicipalRecordRow,
  type MunicipalListResult,
  type MunicipalRecordRow,
} from "./records";

export async function fetchMunicipalList(
  config: MunicipalServiceConfig,
  query?: { status?: string; page?: number },
): Promise<{ data: MunicipalListResult; source: "api" | "error"; status?: number; errorCode?: string }> {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.page) params.set("page", String(query.page));
  const qs = params.toString();
  const path = qs ? `${config.listPath}?${qs}` : config.listPath;

  const empty: MunicipalListResult = { rows: [], meta: { page: 1, pageSize: 20, total: 0 } };
  const result = await fetchJson<unknown, MunicipalListResult>(path, empty, {
    revalidateSeconds: 15,
    telemetryKey: `municipal.${config.serviceKey}.list`,
    mapResponse: (payload) => parseListPayload(payload, config),
  });
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-03: surface the HTTP status/code so the
  // page can tell a 403 (permission) apart from a 500 (transient) instead of
  // treating every failure alike.
  return { data: result.data, source: result.source, status: result.status, errorCode: result.errorCode };
}

export async function fetchMunicipalDetail(
  config: MunicipalServiceConfig,
  id: string,
): Promise<{ data: MunicipalRecordRow | null; raw: Record<string, unknown> | null; source: "api" | "error"; status?: number; errorCode?: string }> {
  const path = detailPathFor(config, id);
  const result = await fetchJson<unknown, Record<string, unknown> | null>(path, null, {
    revalidateSeconds: 10,
    telemetryKey: `municipal.${config.serviceKey}.detail`,
    mapResponse: (payload) => parseDetailPayload(payload, config),
  });

  if (!result.data) {
    // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-05: pass through status so the
    // page can call notFound() on a real 404 and show a retry on a 5xx.
    return { data: null, raw: null, source: result.source, status: result.status, errorCode: result.errorCode };
  }

  return {
    data: toMunicipalRecordRow(result.data, config),
    raw: result.data,
    source: result.source,
    status: result.status,
    errorCode: result.errorCode,
  };
}

export interface MunicipalHistoryEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorId: string;
  createdAt: string;
}

/**
 * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02: fetch an application's
 * timeline from the service's history endpoint. Returns [] when the service
 * has no workflow endpoints configured or the fetch fails — the panel then
 * simply shows no History card rather than an error.
 */
export async function fetchMunicipalHistory(
  config: MunicipalServiceConfig,
  id: string,
): Promise<{ events: MunicipalHistoryEvent[]; source: "api" | "error" }> {
  if (!config.workflow) return { events: [], source: "api" };
  const path = `${config.workflow.historyBasePath}/${encodeURIComponent(id)}/history`;
  const result = await fetchJson<unknown, MunicipalHistoryEvent[]>(path, [], {
    revalidateSeconds: 5,
    telemetryKey: `municipal.${config.serviceKey}.history`,
    mapResponse: (payload) => {
      const data = (payload as { data?: unknown })?.data;
      if (!Array.isArray(data)) return [];
      return data.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const r = row as Record<string, unknown>;
        if (typeof r.id !== "string" || typeof r.action !== "string" || typeof r.toStatus !== "string") return [];
        return [{
          id: r.id,
          action: r.action,
          fromStatus: typeof r.fromStatus === "string" ? r.fromStatus : null,
          toStatus: r.toStatus,
          note: typeof r.note === "string" ? r.note : null,
          actorId: typeof r.actorId === "string" ? r.actorId : "",
          createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
        }];
      });
    },
  });
  return { events: result.data, source: result.source };
}
