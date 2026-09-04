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
): Promise<{ data: MunicipalListResult; source: "api" | "error" }> {
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
  return { data: result.data, source: result.source };
}

export async function fetchMunicipalDetail(
  config: MunicipalServiceConfig,
  id: string,
): Promise<{ data: MunicipalRecordRow | null; raw: Record<string, unknown> | null; source: "api" | "error" }> {
  const path = detailPathFor(config, id);
  const result = await fetchJson<unknown, Record<string, unknown> | null>(path, null, {
    revalidateSeconds: 10,
    telemetryKey: `municipal.${config.serviceKey}.detail`,
    mapResponse: (payload) => parseDetailPayload(payload, config),
  });

  if (!result.data) {
    return { data: null, raw: null, source: result.source };
  }

  return {
    data: toMunicipalRecordRow(result.data, config),
    raw: result.data,
    source: result.source,
  };
}
