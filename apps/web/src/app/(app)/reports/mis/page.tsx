import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMISSummary } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";

export default async function MISDashboardPage() {
  const { data: modules, source } = await getMISSummary();

  const totalMetrics = modules.reduce((s, m) => s + m.metrics.length, 0);
  const positiveTrends = modules.flatMap((m) => m.metrics).filter((m) => m.change?.startsWith("+")).length;
  const negativeTrends = modules.flatMap((m) => m.metrics).filter((m) => m.change?.startsWith("-")).length;

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Management Information System"
        subtitle="Consolidated metrics across all modules."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">Build Report</button>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🗄️" iconBg="#e7f3fb" label="Data Sources" value={modules.length} delta="modules" />
        <StatCard icon="📦" iconBg="#eff6ff" label="Total Metrics" value={totalMetrics} />
        <StatCard icon="⚡" iconBg="#ecfdf3" label="Positive Trends" value={positiveTrends} delta="live" up={positiveTrends > 0} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Negative Trends" value={negativeTrends} />
      </StatGrid>

      {modules.length === 0 ? (
        <div className="empty-state" style={{ marginTop: "18px" }}>
          <div className="ic">📊</div>
          <h4>MIS data compiling</h4>
          <p>Please check back shortly.</p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: "18px" }}>
          <div className="card-h"><h3>Cross-department datasets</h3></div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Module</th>
                <th>Metric</th>
                <th className="num">Value</th>
                <th>Unit</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {modules.flatMap((mod) =>
                mod.metrics.map((m, i) => (
                  <tr key={`${mod.module}-${i}`}>
                    {i === 0 ? (
                      <td rowSpan={mod.metrics.length} style={{ fontWeight: 600, verticalAlign: "top" }}>
                        {mod.module}
                      </td>
                    ) : null}
                    <td>{m.label}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{m.value}</td>
                    <td>{m.unit ?? "—"}</td>
                    <td className="num" style={{
                      color: m.change?.startsWith("+") ? "var(--good)" : m.change?.startsWith("-") ? "var(--bad)" : undefined,
                      fontWeight: 500,
                    }}>
                      {m.change ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
