import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKPIs } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { KpiClient } from "./KpiClient";

export default async function KPITrackerPage() {
  const { data: kpis, source } = await getKPIs();

  const onTrack = kpis.filter((k) => k.status === "on_track").length;
  const atRisk = kpis.filter((k) => k.status === "at_risk").length;
  const offTrack = kpis.filter((k) => k.status === "off_track").length;
  const outcomeLinked = kpis.filter((k) => k.unit === "%" || k.unit === "pct").length;

  function statusLabel(s: string) {
    if (s === "on_track") return "Met";
    if (s === "at_risk") return "Near";
    if (s === "off_track") return "Below";
    return s;
  }

  function statusPill(s: string) {
    if (s === "on_track") return "active";
    if (s === "at_risk") return "pending";
    return "rejected";
  }

  type KpiRow = {
    id: string;
    kpiName: string;
    module: string;
    unit: string;
    period: string;
    statusLabel: string;
    statusPill: string;
    rawStatus: string;
  };

  const rows: KpiRow[] = kpis.map((kpi) => ({
    id: kpi.id,
    kpiName: kpi.kpiName,
    module: kpi.module,
    unit: kpi.unit,
    period: kpi.period,
    statusLabel: statusLabel(kpi.status),
    statusPill: statusPill(kpi.status),
    rawStatus: kpi.status,
  }));

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="KPI Monitoring"
        subtitle="Department KPIs &amp; outcome indicators with targets."
        actions={
          <Link href="/reports/list/new?reportType=kpi-target" className="btn primary">Set Targets</Link>
        }
      />

      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7f3fb" label="KPIs Tracked" value={kpis.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On / Above Target" value={onTrack} delta={`${kpis.length ? Math.round((onTrack / kpis.length) * 100) : 0}%`} up={onTrack > 0} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Below Target" value={offTrack + atRisk} />
        <StatCard icon="🔗" iconBg="#eff6ff" label="Outcome-linked" value={outcomeLinked} delta="→ budget" />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>KPI monitoring</h3>
        </div>
        {kpis.length === 0 ? (
          <EmptyState icon="🎯" title="No KPI data available" message="KPIs will appear once the service has processed data." />
        ) : (
          <KpiClient rows={rows} />
        )}
      </div>
    </div>
  );
}
