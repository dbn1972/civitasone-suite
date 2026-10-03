import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { mapTdsFilings, type TdsFiling } from "./tdsFilings";

export async function getTdsFilings(fy: string): Promise<LoaderResult<TdsFiling[]>> {
  return fetchJson<unknown, TdsFiling[]>(`/api/v1/finance/tds-returns?fy=${encodeURIComponent(fy)}`, [], {
    revalidateSeconds: 30,
    telemetryKey: "finance.tds-return-filings",
    mapResponse: mapTdsFilings,
  });
}
