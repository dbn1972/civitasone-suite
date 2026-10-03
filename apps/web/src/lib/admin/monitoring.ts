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
  /** ISO time this row was measured (row field, else the response's generatedAt). */
  checkedAt: string;
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
export function toApiEndpointRow(e: Record<string, unknown>, generatedAt?: string): ApiEndpointRow {
  const rowTime = [e.checkedAt, e.lastCheckedAt].find((x): x is string => typeof x === "string" && Number.isFinite(Date.parse(x)));
  return {
    ...e,
    service: String(e.service ?? ""),
    endpoint: String(e.endpoint ?? ""),
    p95Latency: e.p95Latency ?? e.p95 ?? null,
    errorRate: e.errorRate ?? null,
    requestsPerMin: e.requestsPerMin ?? null,
    status: normaliseStatus(e.status),
    checkedAt: rowTime ?? generatedAt ?? "",
  };
}

// GAP-ADMIN-API-MONITORING-06 ------------------------------------------------
// Wire contract for GET /v1/admin/api-monitoring rows (no service in this tree serves
// it yet, so this is the contract a serving service must meet; see the PR's VERIFY list):
//   errorRate    number = PERCENT of requests (0-100), or a string such as "1.2%"
//   p95Latency   number = milliseconds (the column header already says "p95 (ms)")
//   checkedAt    ISO timestamp the row was measured; the envelope's generatedAt is the fallback
// A value outside the contract renders as "-", never as a guessed number.

/** Error-rate thresholds (percent): below WARN is healthy, from CRIT is bad. VERIFY with the SRE owner. */
export const ERROR_RATE_WARN_PCT = 1;
export const ERROR_RATE_CRIT_PCT = 5;
/** A snapshot older than this is flagged as stale. VERIFY with the SRE owner. */
export const API_SNAPSHOT_STALE_MS = 5 * 60 * 1000;

export type ErrorRateTone = "good" | "warn" | "bad" | "mut";

/** Percent value of an errorRate cell, or null when it is missing / not a finite 0-100 number. */
export function parseErrorRatePct(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/.exec(v);
    if (!m) return null;
    n = Number(m[1]);
  } else return null;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export function errorRateView(v: unknown): { text: string; tone: ErrorRateTone; label: string } {
  const pct = parseErrorRatePct(v);
  if (pct === null) return { text: "\u2014", tone: "mut", label: "Error rate not reported" };
  const text = `${Number(pct.toFixed(2))}%`;
  if (pct >= ERROR_RATE_CRIT_PCT) return { text, tone: "bad", label: `${text} error rate, high` };
  if (pct >= ERROR_RATE_WARN_PCT) return { text, tone: "warn", label: `${text} error rate, elevated` };
  return { text, tone: "good", label: `${text} error rate, normal` };
}

/** p95 latency as "123 ms"; missing / non-numeric / negative -> em dash. */
export function formatLatencyMs(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? `${Math.round(n)} ms` : "\u2014";
}

/** Newest valid timestamp among the rows' checkedAt values, as an ISO string, or null when none is reported. */
export function newestCheckedAt(rows: ReadonlyArray<{ checkedAt?: unknown }>): string | null {
  let best: number | null = null;
  for (const r of rows) {
    if (typeof r.checkedAt !== "string") continue;
    const t = Date.parse(r.checkedAt);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

export function isSnapshotStale(checkedAtIso: string | null, nowMs: number): boolean {
  if (!checkedAtIso) return false;
  const t = Date.parse(checkedAtIso);
  return Number.isFinite(t) && nowMs - t > API_SNAPSHOT_STALE_MS;
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
