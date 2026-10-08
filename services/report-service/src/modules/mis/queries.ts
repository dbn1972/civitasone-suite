import { listKpis } from "../kpis/queries.js";

export async function listMisSummary(tenantId: string, limit: number) {
  const kpis = await listKpis(tenantId, limit);
  const byModule = new Map<string, typeof kpis>();
  for (const kpi of kpis) {
    const group = byModule.get(kpi.module) ?? [];
    group.push(kpi);
    byModule.set(kpi.module, group);
  }
  return Array.from(byModule.entries()).map(([module, items]) => ({
    module,
    metrics: items.map((k) => ({
      label: k.kpiName,
      value: String(k.currentValue),
      unit: k.unit,
      // GAP2-REPORTS-MIS-01: the KPI source carries no prior-period value, so
      // there is no real magnitude of change to report. The old
      // `trend === "up" ? "+5%" : trend === "down" ? "-3%" : "0%"` invented a
      // confident +5%/-3% presented to department users as real movement.
      // `change` is omitted entirely; the page already defaults `m.change ??
      // "—"` so the Change cell shows "—" when no prior value is stored. The
      // trend direction (k.trend) is still available for an arrow cue without
      // a fabricated magnitude.
    })),
  }));
}
