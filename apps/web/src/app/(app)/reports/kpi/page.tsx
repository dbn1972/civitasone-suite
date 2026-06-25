import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKPIs } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";

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

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="KPI Monitoring"
        subtitle="Department KPIs &amp; outcome indicators with targets."
        actions={
          <>
            <button className="btn ghost">Outcome budget</button>
            <Link href="/reports/list/new?reportType=kpi-target" className="btn primary">Set Targets</Link>
          </>
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
          <div className="seg"><span className="on">All</span><span>Below target</span></div>
        </div>
        {kpis.length === 0 ? (
          <div className="empty-state">
            <div className="ic">🎯</div>
            <h4>No KPI data available</h4>
            <p>KPIs will appear once the service has processed data.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Owner Module</th>
                <th>Unit</th>
                <th>Period</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((kpi) => (
                <tr key={kpi.id}>
                  <td>{kpi.kpiName}</td>
                  <td>{kpi.module}</td>
                  <td>{kpi.unit}</td>
                  <td>{kpi.period}</td>
                  <td><StatusPill status={statusPill(kpi.status)} label={statusLabel(kpi.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
