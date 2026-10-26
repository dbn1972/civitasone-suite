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
  // GAP-VISITOR-GUARD-01: the non-emergency active endpoint responds with
  // { data: { visitors: [...] } }. No raw phone/email is returned.
  const data = pickData(payload);
  const visitors =
    data && typeof data === "object" && "visitors" in data
      ? (data as { visitors: unknown }).visitors
      : data;
  return asArray(visitors).map((o) => ({
    passId: str(o.passId),
    visitorName: str(o.visitorName),
    hostEmployeeId: str(o.hostEmployeeId),
    locationId: str(o.locationId),
    checkInTime: str(o.checkInTime),
    validUntil: strOrNull(o.validUntil),
    overstay: Boolean(o.overstay),
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

/** Server list cap per page (visitor-service MAX_LIST_LIMIT); we follow meta.hasMore past it. */
const VISIT_REQUEST_PAGE_SIZE = 500;
/** Safety bound on page-following so a misbehaving server cannot loop us forever. */
const VISIT_REQUEST_MAX_PAGES = 40;

function hasMoreFlag(payload: unknown): boolean {
  if (payload && typeof payload === "object" && "meta" in payload) {
    const meta = (payload as { meta?: { hasMore?: unknown } }).meta;
    return meta?.hasMore === true;
  }
  return false;
}

/**
 * Approved / pending / etc. visit requests. Omit status to list all.
 * The API caps each page (CLOS3-S6-15), so this follows `meta.hasMore` until the
 * whole set is read; a tenant with more than one page never sees a silently
 * truncated list. A failure on any page reports source:"error".
 */
export async function getVisitRequests(
  status?: VisitRequestStatus,
): Promise<LoaderResult<VisitRequest[]>> {
  const all: VisitRequest[] = [];
  for (let page = 0; page < VISIT_REQUEST_MAX_PAGES; page++) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("limit", String(VISIT_REQUEST_PAGE_SIZE));
    params.set("offset", String(page * VISIT_REQUEST_PAGE_SIZE));
    let more = false;
    const res = await fetchJson<unknown, VisitRequest[]>(
      `/api/v1/visitor/visit-requests?${params.toString()}`,
      [],
      {
        revalidateSeconds: 15,
        telemetryKey: `visitor.visit-requests.${status ?? "all"}`,
        mapResponse: (payload) => {
          more = hasMoreFlag(payload);
          return mapVisitRequests(payload);
        },
      },
    );
    if (res.source === "error") return { ...res, data: all };
    all.push(...res.data);
    if (!more) return { ...res, data: all };
  }
  // Page bound hit with more remaining: surface as an error rather than a silent truncation.
  return { data: all, source: "error" };
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
 * Live premises roster for a location, via the NORMAL role-gated
 * `GET /v1/visitor/check-ins/active` endpoint (GAP-VISITOR-GUARD-01). This is
 * the everyday "inside now" read for the guard console; it returns no raw
 * phone/email/identity document. The separate evacuation roster
 * (/evacuation/roster) stays fail-closed IP-allowlisted for break-glass only.
 */
export function getRoster(
  locationId: string,
): Promise<LoaderResult<RosterEntry[]>> {
  const qs = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  return fetchJson<unknown, RosterEntry[]>(
    `/api/v1/visitor/check-ins/active${qs}`,
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
