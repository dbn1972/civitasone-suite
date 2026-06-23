import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatusPill } from "../../../_components/ds";
import { getRiskRegister } from "../../../_data/loaders";

function ratingPill(score: number) {
  if (score >= 15) return <span className="pill bad">High</span>;
  if (score >= 6) return <span className="pill warn">Medium</span>;
  return <span className="pill mut">Low</span>;
}

export default async function RiskRegisterPage() {
  const { data: items, source } = await getRiskRegister();

  const total = items.length;
  const high = items.filter((i) => i.riskScore >= 15).length;
  const medium = items.filter((i) => i.riskScore >= 6 && i.riskScore < 15).length;
  const low = items.filter((i) => i.riskScore < 6).length;

  return (
    <div className="wrap">
      <PageHeader
        title="Enterprise Risk Register"
        subtitle="Identify, score (likelihood × impact) and own risks."
        actions={
          <>
            <button className="btn ghost">Heat map</button>
            <button className="btn primary">+ Add Risk</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="⚠️" iconBg="#fef2f2" label="Total Risks" value={total} />
        <StatCard icon="🔴" iconBg="#fff7ed" label="High" value={high} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="Medium" value={medium} />
        <StatCard icon="🟢" iconBg="#ecfdf3" label="Low / Controlled" value={low} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h">
          <h3>Risk register</h3>
          <div className="seg"><span className="on">All</span><span>High</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Risk ID</th>
              <th>Risk</th>
              <th>Owner area</th>
              <th>Rating</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><span className="mono">{item.riskCode}</span></td>
                <td>{item.title}</td>
                <td>{item.owner ?? "—"}</td>
                <td>{ratingPill(item.riskScore)}</td>
                <td>
                  {item.status === "mitigated" ? <span className="pill warn">Mitigating</span>
                    : item.status === "closed" ? <span className="pill good">Controlled</span>
                    : item.status === "escalated" ? <span className="pill bad">Escalated</span>
                    : <span className="pill info">Monitored</span>}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5}><div className="empty-state"><div>⚠️</div><h4>Risk register is empty</h4><p>No risks have been logged yet.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
