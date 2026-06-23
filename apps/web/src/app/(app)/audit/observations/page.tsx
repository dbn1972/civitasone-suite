import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";
import { getAuditObservations } from "../../../_data/loaders";

function riskPill(severity: string) {
  if (severity === "critical" || severity === "major") return <span className="pill bad">{severity}</span>;
  if (severity === "minor") return <span className="pill warn">Medium</span>;
  return <span className="pill mut">Low</span>;
}

export default async function AuditObservationsPage() {
  const { data: items, source } = await getAuditObservations();

  const today = new Date().toISOString().slice(0, 10);
  const open = items.filter((i) => i.status === "open").length;
  const underReply = items.filter((i) => i.status === "replied").length;
  const settled = items.filter((i) => i.status === "closed").length;
  const totalAmount = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const crores = Math.round(totalAmount / 10_000_000);

  return (
    <div className="wrap">
      <PageHeader
        title="Audit Observations"
        subtitle="Internal audit findings with risk & money value."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ Log Observation</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#fef2f2" label="Open" value={open} />
        <StatCard icon="📨" iconBg="#fffaeb" label="Under Reply" value={underReply} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled (FY)" value={settled} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Money Value" value={crores > 0 ? `₹${crores} Cr` : "₹0"} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h">
          <h3>Audit observations</h3>
          <div className="seg"><span className="on">All</span><span>Open</span><span>Settled</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Obs</th>
              <th>Auditee</th>
              <th>Finding</th>
              <th>Risk</th>
              <th>Money value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="clickable" onClick={undefined}>
                <td><Link href={`/audit/observations/${item.id}`}><span className="mono">{item.observationNo}</span></Link></td>
                <td>{item.department ?? "—"}</td>
                <td>{item.title}</td>
                <td>{riskPill(item.severity)}</td>
                <td className="num">{item.amount ? `₹${(item.amount / 100).toLocaleString("en-IN")}` : "—"}</td>
                <td>
                  {item.status === "open" ? <span className="pill warn">Open</span>
                    : item.status === "closed" ? <span className="pill good">Settled</span>
                    : item.status === "replied" ? <span className="pill info">Under reply</span>
                    : <StatusPill status={item.status} />}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state"><div>📋</div><h4>No observations</h4><p>Audit observations will appear here once raised.</p></div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
