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
      change: k.trend === "up" ? "+5%" : k.trend === "down" ? "-3%" : "0%",
    })),
  }));
}
