/**
 * Pure view-model helpers for /admin/gateways (communication gateways).
 * GAP-ADMIN-GATEWAYS-04/05.
 */
import { formatIndianDateTime, formatPercent } from "@/lib/formatters";

export type GatewayRow = {
  type: string;
  provider: string;
  /** Raw numbers so the table sorts numerically; formatted at render time. */
  messagesPerDay: number | null;
  /** 0-100, or null when absent / unparseable. */
  successRate: number | null;
  lastChecked: string;
  status: string;
};

function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Success rate as a 0-100 percentage. The API unit is not documented: a number
 * in [0, 1] is read as a fraction (0.987 -> 98.7), a larger number as already a
 * percentage (98.7 -> 98.7). Unparseable values -> null (rendered as an em dash).
 */
export function successRatePercent(v: unknown): number | null {
  const s = text(v).replace(/%$/, "");
  if (s === "" || !Number.isFinite(Number(s))) return null;
  const n = Number(s);
  return n >= 0 && n <= 1 ? n * 100 : n;
}

export function formatSuccessRate(pct: number | null): string {
  return formatPercent(pct, 1);
}

export function formatMessagesPerDay(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-IN");
}

function formatLastChecked(v: unknown): string {
  const s = text(v);
  if (s === "") return "—";
  return Number.isNaN(Date.parse(s)) ? s : formatIndianDateTime(s);
}

export function toGatewayRow(raw: Record<string, unknown>): GatewayRow {
  const m = text(raw.messagesPerDay);
  return {
    type: text(raw.type),
    provider: text(raw.provider),
    messagesPerDay: m !== "" && Number.isFinite(Number(m)) ? Number(m) : null,
    successRate: successRatePercent(raw.successRate),
    lastChecked: formatLastChecked(raw.lastChecked),
    status: text(raw.status),
  };
}

const DOWN = new Set(["down", "failed", "failure", "error", "outage", "offline"]);

export type GatewaySummary = {
  total: number;
  active: number;
  degraded: number;
  standby: number;
  /** down | failed | error | outage | offline -- an outage must never read as Standby. */
  down: number;
  /** Any other / unknown status. */
  other: number;
};

export function summarizeGateways(rows: GatewayRow[]): GatewaySummary {
  const s = (r: GatewayRow) => r.status.toLowerCase();
  const active = rows.filter((r) => s(r) === "active").length;
  const degraded = rows.filter((r) => s(r) === "degraded").length;
  const standby = rows.filter((r) => s(r) === "standby").length;
  const down = rows.filter((r) => DOWN.has(s(r))).length;
  return { total: rows.length, active, degraded, standby, down, other: rows.length - active - degraded - standby - down };
}
