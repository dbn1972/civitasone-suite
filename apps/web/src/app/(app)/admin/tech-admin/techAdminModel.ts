import { countServiceBuckets } from "@/lib/admin/serviceStatus";

type Row = Record<string, unknown>;

export type TechAdminSummary = { total: number | null; running: number | null; down: number | null; degraded: number | null; unknown: number | null };

/**
 * GAP-ADMIN-TECH-ADMIN-02/-03/-04: the tiles are derived from the SAME rows the
 * table shows (cached copy included), degraded is an explicit match -- never
 * "everything that is neither running nor stopped" -- and an unrecognised status
 * is its own "Unknown" bucket. With nothing to show (failed load, no cache) every
 * tile is null so StatCard renders a dash, not a fabricated 0.
 */
export function summariseServices(rows: readonly Row[], unavailable: boolean): TechAdminSummary {
  if (unavailable) return { total: null, running: null, down: null, degraded: null, unknown: null };
  const c = countServiceBuckets(rows);
  return { total: rows.length, running: c.up, down: c.down, degraded: c.degraded, unknown: c.unknown };
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

/**
 * Bytes -> "512 MB" / "1.5 GB". A value that is not a plain number (the API
 * already sent "512 MB") is shown as-is; missing is a dash.
 * VERIFY: assumes numeric input is bytes (the field type is not documented).
 */
export function formatMemory(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = num(v);
  if (n === null) return String(v);
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  if (mb < 1024) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

/** Seconds -> "1d 1h" / "3h 5m" / "42s". Non-numeric input is shown as-is. VERIFY: assumes seconds. */
export function formatUptime(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = num(v);
  if (n === null) return String(v);
  const s = Math.floor(n);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
