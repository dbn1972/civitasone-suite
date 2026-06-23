import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatusPill } from "../../../_components/ds";
import { getAuditCompliance } from "../../../_data/loaders";

export default async function AuditCompliancePage() {
  const { data: items, source } = await getAuditCompliance();

  const total = items.length;
  const complied = items.filter((i) => i.status === "complied").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const overdue = items.filter((i) => i.status === "overdue").length;
  const score = total > 0 ? Math.round((complied / total) * 100) : 0;

  const dpdpItems = items.filter((i) => i.lawOrRule.toLowerCase().includes("dpdp") || i.lawOrRule.toLowerCase().includes("data"));
  const certItems = items.filter((i) => i.lawOrRule.toLowerCase().includes("cert") || i.lawOrRule.toLowerCase().includes("iso") || i.lawOrRule.toLowerCase().includes("ntp"));
  const displayDpdp = dpdpItems.length > 0 ? dpdpItems : items.slice(0, Math.ceil(items.length / 2));
  const displayCert = certItems.length > 0 ? certItems : items.slice(Math.ceil(items.length / 2));

  return (
    <div className="wrap">
      <PageHeader
        title="Compliance — DPDP & CERT-In"
        subtitle="Data-protection (DPDP Act), CERT-In directions & security-policy posture."
        actions={
          <>
            <button className="btn ghost">Evidence</button>
            <button className="btn primary">Generate Report</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="#f5f3ff" label="Compliance Score" value={`${score}%`} />
        <StatCard icon="🔏" iconBg="#e6f7f0" label="Controls Complied" value={`${complied} / ${total}`} />
        <StatCard icon="🛡️" iconBg="#eff8ff" label="CERT-In Directions" value={overdue === 0 ? "Compliant" : "Review"} delta="6-hr reporting" up={overdue === 0} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Open Actions" value={pending + overdue} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2">
        <div className="card">
          <div className="card-h"><h3>Compliance requirements</h3></div>
          <table className="tbl">
            <thead><tr><th>Law / Rule</th><th>Requirement</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {displayDpdp.map((item) => (
                <tr key={item.id}>
                  <td>{item.lawOrRule}{item.section ? ` §${item.section}` : ""}</td>
                  <td>{item.requirement}</td>
                  <td>{item.dueDate}</td>
                  <td>
                    {item.status === "complied" ? <span className="pill good">Compliant</span>
                      : item.status === "overdue" ? <span className="pill bad">Overdue</span>
                      : item.status === "pending" ? <span className="pill warn">In progress</span>
                      : <span className="pill mut">Planned</span>}
                  </td>
                </tr>
              ))}
              {displayDpdp.length === 0 && <tr><td colSpan={4}><div className="empty-state"><div>📜</div><h4>No items</h4><p>Compliance requirements will appear here once configured.</p></div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-h"><h3>Regulatory &amp; govt policy</h3></div>
          <table className="tbl">
            <thead><tr><th>Law / Rule</th><th>Requirement</th><th>Dept</th><th>Status</th></tr></thead>
            <tbody>
              {displayCert.map((item) => (
                <tr key={item.id}>
                  <td>{item.lawOrRule}</td>
                  <td>{item.requirement}</td>
                  <td>{item.department ?? "—"}</td>
                  <td>
                    {item.status === "complied" ? <span className="pill good">Compliant</span>
                      : item.status === "overdue" ? <span className="pill bad">Overdue</span>
                      : item.status === "pending" ? <span className="pill warn">In progress</span>
                      : <span className="pill mut">Planned</span>}
                  </td>
                </tr>
              ))}
              {displayCert.length === 0 && <tr><td colSpan={4}><div className="empty-state"><div>📋</div><h4>No items</h4><p></p></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
