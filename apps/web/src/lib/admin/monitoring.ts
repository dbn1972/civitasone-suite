/**
 * Pure helpers for the admin/api-monitoring and admin/editions summary cards.
 *
 * GAP-ADMIN-API-MONITORING-04 / GAP-ADMIN-EDITIONS-04: "Down" used to be
 * `total - healthy - degraded` and "Deprecated" was `total - active`, so any
 * unrecognised status (maintenance, unknown, draft, a missing field...) was
 * painted as an outage / a deprecation. Each bucket now counts only the
 * statuses that actually mean it, and everything else is reported as "other".
 *
 * The admin API behind these two screens is not part of this repository, so the
 * status vocabularies are the conservative supersets below; a value outside them
 * lands in "other" rather than in a red bucket.
 */

export type ApiEndpointRow = {
  service: string;
  endpoint: string;
  p95Latency: unknown;
  errorRate: unknown;
  requestsPerMin: unknown;
  status: string;
} & Record<string, unknown>;

export type EditionRow = {
  name: string;
  modulesIncluded: unknown;
  pricing: unknown;
  tenants: unknown;
  status: string;
} & Record<string, unknown>;

export const API_HEALTHY_STATUSES: ReadonlySet<string> = new Set(["healthy", "up", "ok", "operational"]);
export const API_DEGRADED_STATUSES: ReadonlySet<string> = new Set(["degraded", "slow", "partial outage"]);
export const API_DOWN_STATUSES: ReadonlySet<string> = new Set(["down", "unhealthy", "error", "offline", "failed", "outage"]);

function norm(status: unknown): string {
  if (status === null || status === undefined) return "";
  return String(status).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export interface ApiMonitoringCounts {
  endpoints: number;
  healthy: number;
  degraded: number;
  down: number;
  other: number;
}

export function countApiStatuses(rows: ReadonlyArray<{ status?: unknown }>): ApiMonitoringCounts {
  let healthy = 0, degraded = 0, down = 0;
  for (const r of rows) {
    const s = norm(r.status);
    if (API_HEALTHY_STATUSES.has(s)) healthy++;
    else if (API_DEGRADED_STATUSES.has(s)) degraded++;
    else if (API_DOWN_STATUSES.has(s)) down++;
  }
  return { endpoints: rows.length, healthy, degraded, down, other: rows.length - healthy - degraded - down };
}

export interface EditionCounts {
  total: number;
  active: number;
  deprecated: number;
  /** draft / retired / unknown statuses: neither live nor deprecated. */
  other: number;
  tenants: number;
}

export function countEditions(rows: ReadonlyArray<{ status?: unknown; tenants?: unknown }>): EditionCounts {
  let active = 0, deprecated = 0, tenants = 0;
  for (const r of rows) {
    const s = norm(r.status);
    if (s === "active") active++;
    else if (s === "deprecated" || s === "sunset") deprecated++;
    const n = Number(r.tenants ?? 0);
    if (Number.isFinite(n)) tenants += n;
  }
  return { total: rows.length, active, deprecated, other: rows.length - active - deprecated, tenants };
}

/**
 * A service/route status value (not an HTTP code) as a non-empty string; a missing,
 * blank or non-scalar value becomes "unknown" so it can never render as a blank pill.
 */
export function normaliseStatus(v: unknown): string {
  if (typeof v === "string") return v.trim() === "" ? "unknown" : v;
  if (typeof v === "number" || typeof v === "boolean") return `${v}`;
  return "unknown";
}

/** Maps the loader's loose records onto the typed row (same defensive style as the other admin loaders). */
export function toApiEndpointRow(e: Record<string, unknown>): ApiEndpointRow {
  return {
    ...e,
    service: String(e.service ?? ""),
    endpoint: String(e.endpoint ?? ""),
    p95Latency: e.p95Latency ?? e.p95 ?? null,
    errorRate: e.errorRate ?? null,
    requestsPerMin: e.requestsPerMin ?? null,
    status: normaliseStatus(e.status),
  };
}

export function toEditionRow(e: Record<string, unknown>): EditionRow {
  return {
    ...e,
    name: String(e.name ?? ""),
    modulesIncluded: e.modulesIncluded ?? null,
    pricing: e.pricing ?? null,
    tenants: e.tenants ?? 0,
    status: normaliseStatus(e.status),
  };
}
