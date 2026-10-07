import { fetchJson } from "@/app/_data/apiClient";
import { parsePublishedService, type PublishedServiceRuntime } from "./runtimeApi";

export interface LoadServiceResult {
  service: PublishedServiceRuntime | null;
  source: "api" | "error";
  status?: number;
}

/**
 * GAP-CITIZEN-SERVICES-SERVICEKEY-01 — shared published-service loader for the
 * service landing and apply pages (both previously duplicated this and called
 * notFound() on ANY failure, so a gateway blip or expired session showed a 404
 * with no retry). This returns the loader `status` so the caller can tell a
 * real 404 apart from a transient 5xx / network error and from a 401.
 *
 * `revalidateSeconds` differs per page (30s cache on the read-only landing
 * page, 0 on the apply flow), so it stays a parameter.
 */
export async function loadService(
  serviceKey: string,
  opts: { revalidateSeconds: number; telemetryKey: string },
): Promise<LoadServiceResult> {
  const result = await fetchJson<unknown, ReturnType<typeof parsePublishedService>>(
    `/api/v1/citizen/catalogue/published/lookup?serviceKey=${encodeURIComponent(serviceKey)}`,
    null,
    {
      revalidateSeconds: opts.revalidateSeconds,
      telemetryKey: opts.telemetryKey,
      mapResponse: (p) => parsePublishedService(p),
    },
  );
  return { service: result.data, source: result.source, status: result.status };
}

export type ServiceLoadOutcome =
  | { kind: "ok"; service: PublishedServiceRuntime }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "unavailable"; status?: number };

/**
 * Classify a load result into an actionable outcome. A real 404 (or an `api`
 * source that still produced no service) is not-found; 401 means the session
 * expired; everything else (5xx, network, no base URL) is a retryable
 * "unavailable" — NOT a 404. Never treat 403 as retryable.
 */
export function classifyServiceLoad(result: LoadServiceResult): ServiceLoadOutcome {
  if (result.service && result.source === "api") return { kind: "ok", service: result.service };
  if (result.status === 404) return { kind: "not_found" };
  if (result.source === "api" && !result.service) return { kind: "not_found" };
  if (result.status === 401) return { kind: "unauthorized" };
  if (result.status === 403) return { kind: "not_found" };
  return { kind: "unavailable", status: result.status };
}
