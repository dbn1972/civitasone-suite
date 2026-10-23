/**
 * Server-side call metrics for the Telephony KPIs.
 *
 * The hub strip, the Call Log cards and the whole Dispositions breakdown used to
 * be derived by counting the rows of ONE default page (50) of
 * GET /v1/telephony/calls, so any tenant with more calls saw silently capped
 * figures. GET /v1/telephony/calls/metrics aggregates the full, optionally
 * windowed (`from`) call set in SQL; these helpers only map that payload.
 */
import type { CallSummary } from "./callSummary";

export type CallMetrics = {
  total: number;
  live: number;
  /** answered + completed (status), same meaning as the old per-row summary. */
  answered: number;
  abandoned: number;
  slaScored: number;
  slaMet: number;
  /** Whole-percent SLA over scored calls, null when nothing is scored (render "—"). */
  slaPct: number | null;
  /** Completed calls and their wrap-up code breakdown (null disposition = no code). */
  completed: number;
  dispositions: Array<{ disposition: string | null; count: number }>;
};

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Strictly validate the metrics payload; null (never zeros) when it is not the expected shape. */
export function toCallMetrics(payload: unknown): CallMetrics | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const byStatus = p.byStatus as Record<string, unknown> | undefined;
  if (
    !byStatus ||
    !isCount(p.total) ||
    !isCount(p.live) ||
    !isCount(p.abandoned) ||
    !isCount(p.slaScored) ||
    !isCount(p.slaMet) ||
    !isCount(p.completed) ||
    !isCount(byStatus.answered) ||
    !isCount(byStatus.completed) ||
    !Array.isArray(p.dispositions) ||
    !(p.slaPct === null || isCount(p.slaPct))
  ) {
    return null;
  }
  const dispositions: CallMetrics["dispositions"] = [];
  for (const d of p.dispositions) {
    if (!d || typeof d !== "object") return null;
    const row = d as { disposition?: unknown; count?: unknown };
    if (!isCount(row.count) || !(row.disposition === null || typeof row.disposition === "string")) return null;
    dispositions.push({ disposition: row.disposition, count: row.count });
  }
  return {
    total: p.total,
    live: p.live,
    answered: byStatus.answered + byStatus.completed,
    abandoned: p.abandoned,
    slaScored: p.slaScored,
    slaMet: p.slaMet,
    slaPct: p.slaPct as number | null,
    completed: p.completed,
    dispositions,
  };
}

/** `/v1/telephony/calls/metrics`, windowed by createdAt when `from` is given. */
export function callMetricsPath(from: string | null): string {
  return from ? `/v1/telephony/calls/metrics?from=${encodeURIComponent(from)}` : "/v1/telephony/calls/metrics";
}

/** Same shape the per-row summariseCalls() returned, so the cards render unchanged. */
export function metricsToSummary(m: CallMetrics): CallSummary {
  return {
    total: m.total,
    live: m.live,
    answered: m.answered,
    abandoned: m.abandoned,
    slaScored: m.slaScored,
    slaMet: m.slaMet,
    slaPct: m.slaPct,
  };
}
