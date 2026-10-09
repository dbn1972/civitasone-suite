import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { KpiRow } from "./schema.js";

function mapTrend(trend: string): "up" | "down" | "stable" {
  if (trend === "up") return "up";
  if (trend === "down") return "down";
  return "stable";
}

function mapStatus(status: string): "on_track" | "at_risk" | "off_track" {
  if (status === "at_risk") return "at_risk";
  if (status === "off_track") return "off_track";
  return "on_track";
}

function mapKpiRow(row: KpiRow) {
  const target = Number(row.targetValue);
  const current = Number(row.currentValue);
  const achievementPct = target > 0 ? Math.round((current / target) * 1000) / 10 : 0;
  return {
    id: row.id,
    kpiName: row.kpiName,
    module: row.module,
    targetValue: target,
    currentValue: current,
    unit: row.unit,
    achievementPct,
    period: row.period,
    trend: mapTrend(row.trend),
    status: mapStatus(row.status),
  };
}

export async function listKpis(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "report_kpis", `list:${limit}`),
    () => repo.listByTenant(tenantId, limit),
    60,
  );
  return (rows ?? []).map(mapKpiRow);
}

export async function listDashboardItems(tenantId: string, limit = 10) {
  const kpis = await listKpis(tenantId, limit);
  return kpis.map((k) => ({
    id: k.id,
    title: k.kpiName,
    module: k.module,
    value: k.currentValue,
    unit: k.unit,
    // GAP2-REPORTS-DASHBOARD-01: the KPI row carries no prior-period value
    // (reports.kpis has no previous_value column), so there is NO honest
    // period-over-period delta to report. The old `achievementPct >= 100 ? 5
    // : -3` fabricated a confident +5/-3 that had no relation to any actual
    // movement. `changePct` is therefore omitted entirely; the web already
    // handles `changePct === undefined` by rendering "Trending down vs
    // previous period" instead of a bare invented percentage. The trend
    // direction below is a real stored signal (reports.kpis.trend) and still
    // drives the up/down arrow.
    changeDirection: (k.trend === "up" ? "up" : k.trend === "down" ? "down" : "neutral") as "up" | "down" | "neutral",
  }));
}
