import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatusPill } from "../../../_components/ds";
import { getCourtOrders } from "../../../_data/loaders";

export default async function CourtOrdersPage() {
  const { data: items, source } = await getCourtOrders();

  const today = new Date().toISOString().slice(0, 10);
  const soonThreshold = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  const total = items.length;
  const pendingCompliance = items.filter((i) => i.complianceRequired && i.status === "pending").length;
  const complied = items.filter((i) => i.status === "complied").length;
  const contemptRisk = items.filter(
    (i) => i.complianceRequired && i.status === "pending" && i.complianceDeadline && i.complianceDeadline <= today,
  ).length;

  return (
    <div className="wrap">
      <div className="banner" style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", color: "#334155", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
        📜 <b>Order compliance</b> routed to the owning dept; non-compliance risks contempt. Linked to Establishment files for action.
      </div>
      <PageHeader
        title="Court Order Compliance"
        subtitle="Track implementation of court orders & judgments."
        actions={
          <>
            <button className="btn ghost">Contempt watch</button>
            <Link href="/legal/court-orders/new" className="btn primary">+ Record Order</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="#f1f5f9" label="Orders Tracked" value={total} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Compliance Due" value={pendingCompliance} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Complied" value={complied} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Contempt Risk" value={contemptRisk} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h">
          <h3>Court order compliance</h3>
          <div className="seg"><span className="on">All</span><span>Due</span><span>Risk</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Case</th>
              <th>Direction</th>
              <th>Dept</th>
              <th>Type</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={`/legal/cases/${item.caseId}`} className="lnk">
                    <span className="mono">{item.caseNo}</span>
                  </Link>
                </td>
                <td>{item.summary}</td>
                <td>{item.department ?? "—"}</td>
                <td>{item.complianceRequired ? "Issued" : "Stay"}</td>
                <td>{item.complianceDeadline ?? "—"}</td>
                <td>
                  {item.status === "complied" ? <span className="pill good">Complied</span>
                    : item.status === "pending" && item.complianceDeadline && item.complianceDeadline <= today ? <span className="pill bad">Overdue</span>
                    : item.status === "pending" ? <span className="pill warn">Compliance due</span>
                    : item.status === "appealed" ? <span className="pill info">Under compliance</span>
                    : item.status === "stayed" ? <span className="pill mut">Stayed</span>
                    : <StatusPill status={item.status} />}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6}><div className="empty-state"><div>📜</div><h4>No court orders</h4><p>Court orders will appear here once recorded against cases.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
