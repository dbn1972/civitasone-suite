/**
 * visitor feature — server-side loaders (Server Components only).
 *
 * Follows the app convention (see src/app/_data/apiClient.ts + loaders.ts):
 * every loader returns LoaderResult<T> = { data, source } and never throws.
 * On any failure (no base URL, 401, network, bad shape) it returns empty data
 * with source:"error" so pages can degrade gracefully via <DataSourceBadge/>.
 *
 * Gateway routing: paths are prefixed "/api/v1/visitor/..." exactly like the
 * helpdesk/citizen loaders — apiClient forwards to ${CIVITASONE_API_BASE_URL}.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type {
  ConfigEntry,
  RosterEntry,
  VisitRequest,
  VisitRequestStatus,
  VisitorLocation,
} from "./types";

function pickData(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function asArray(x: unknown): Record<string, unknown>[] {
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function mapVisitRequests(payload: unknown): VisitRequest[] {
  return asArray(pickData(payload)).map((o) => ({
    id: str(o.id),
    status: (str(o.status, "pending_approval") as VisitRequestStatus),
    purpose: strOrNull(o.purpose),
    scheduledAt: strOrNull(o.scheduledAt),
    visitorName: str(o.visitorName),
    visitorPhone: str(o.visitorPhone),
    visitorEmail: strOrNull(o.visitorEmail),
    hostEmployeeId: str(o.hostEmployeeId),
    locationId: str(o.locationId),
    passType: str(o.passType, "single"),
    visitorCategory: str(o.visitorCategory, "standard"),
    permittedAreas: Array.isArray(o.permittedAreas) ? (o.permittedAreas as string[]) : [],
    rejectionReason: strOrNull(o.rejectionReason),
    trackingRef: strOrNull(o.trackingRef),
    createdAt: strOrNull(o.createdAt),
  }));
}

function mapLocations(payload: unknown): VisitorLocation[] {
  return asArray(pickData(payload)).map((o) => ({
    id: str(o.id),
    name: str(o.name),
    address: strOrNull(o.address),
    status: strOrNull(o.status),
  }));
}

function mapRoster(payload: unknown): RosterEntry[] {
  return asArray(pickData(payload)).map((o) => ({
    passId: str(o.passId),
    visitorName: str(o.visitorName),
    hostName: str(o.hostName),
    checkInTime: str(o.checkInTime),
    lastKnownGate: str(o.lastKnownGate),
    contactNumber: str(o.contactNumber),
    evacuated: Boolean(o.evacuated),
  }));
}

function mapConfig(payload: unknown): ConfigEntry[] {
  // config-registry responds with { items, count, source } (not { data }).
  const items =
    payload && typeof payload === "object" && "items" in payload
      ? (payload as { items: unknown }).items
      : pickData(payload);
  return asArray(items).map((o) => ({
    id: str(o.id),
    namespace: str(o.namespace),
    configKey: str(o.configKey),
    value: o.value,
    label: strOrNull(o.label),
    description: strOrNull(o.description),
    active: o.active !== false,
    sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : 0,
    version: typeof o.version === "number" ? o.version : 1,
  }));
}

/** Approved / pending / etc. visit requests. Omit status to list all. */
export function getVisitRequests(
  status?: VisitRequestStatus,
): Promise<LoaderResult<VisitRequest[]>> {
  const qs = status ? `?status=${status}` : "";
  return fetchJson<unknown, VisitRequest[]>(
    `/api/v1/visitor/visit-requests${qs}`,
    [],
    {
      revalidateSeconds: 15,
      telemetryKey: `visitor.visit-requests.${status ?? "all"}`,
      mapResponse: mapVisitRequests,
    },
  );
}

export function getVisitorLocations(): Promise<LoaderResult<VisitorLocation[]>> {
  return fetchJson<unknown, VisitorLocation[]>(
    "/api/v1/visitor/locations",
    [],
    {
      revalidateSeconds: 300,
      telemetryKey: "visitor.locations",
      mapResponse: mapLocations,
    },
  );
}

/**
 * Live premises roster for a location. NOTE: the underlying evacuation roster
 * endpoint is fail-closed IP-allowlisted (emergency break-glass), so from a
 * non-allowlisted BFF this typically returns source:"error" — the guard
 * console degrades to an empty "inside now" panel. See DELIVER notes.
 */
export function getRoster(
  locationId: string,
): Promise<LoaderResult<RosterEntry[]>> {
  return fetchJson<unknown, RosterEntry[]>(
    `/api/v1/visitor/evacuation/roster?locationId=${encodeURIComponent(locationId)}`,
    [],
    {
      telemetryKey: "visitor.roster",
      mapResponse: mapRoster,
    },
  );
}

/** All config entries in a namespace (e.g. "visitor_policy", "visitor_approval"). */
export function getConfigNamespace(
  namespace: string,
): Promise<LoaderResult<ConfigEntry[]>> {
  return fetchJson<unknown, ConfigEntry[]>(
    `/api/v1/visitor/config/${encodeURIComponent(namespace)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: `visitor.config.${namespace}`,
      mapResponse: mapConfig,
    },
  );
}
