import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatusPill } from "../../../_components/ds";
import { getAuditExports } from "../../../_data/loaders";

export default async function AuditExportsPage() {
  const { data: items, source } = await getAuditExports();

  return (
    <div className="wrap">
      <PageHeader
        title="Compliance Export"
        subtitle="Generate signed, tamper-evident audit exports for regulators."
        actions={
          <>
            <button className="btn ghost">Schedule</button>
            <button className="btn primary">+ New Export</button>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main-l">
        <div className="card">
          <div className="card-h"><h3>Build export</h3></div>
          <div className="pad">
            <label className="lbl">Date range</label>
            <input className="inp" defaultValue="01 Jun 2026 – 19 Jun 2026" readOnly />
            <label className="lbl">Scope</label>
            <input className="inp" defaultValue="All tenants · All services" readOnly />
            <label className="lbl">Format</label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <span className="chip">CSV</span>
              <span className="chip" style={{ background: "var(--primary-soft)", color: "var(--primary-d)" }}>JSON (signed)</span>
              <span className="chip">PDF report</span>
            </div>
            <button className="btn primary" style={{ width: "100%", marginTop: 14 }}>Generate export</button>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Recent exports</h3></div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Export</th>
                <th>Requested</th>
                <th>Format</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.jobType}</td>
                  <td>{item.requestedAt.slice(0, 10)}</td>
                  <td><span className="pill info">{item.format.toUpperCase()}</span></td>
                  <td>
                    {item.status === "completed" ? <span className="pill good">Ready</span>
                      : item.status === "processing" ? <span className="pill warn">Generating</span>
                      : item.status === "failed" ? <span className="pill bad">Failed</span>
                      : <span className="pill mut">Queued</span>}
                  </td>
                  <td>
                    {item.status === "completed" && item.downloadUrl
                      ? <a href={item.downloadUrl} className="lnk" download>Download</a>
                      : <span className="lnk" style={{ color: "#98a2b3" }}>—</span>}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5}><div className="empty-state"><div>📤</div><h4>No export jobs</h4><p>Scheduled export jobs will appear here.</p></div></td></tr>
              )}
            </tbody>
          </table>
          <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: "12.5px", color: "#475467" }}>Exports are cryptographically signed with a 7-year retention lock (WORM).</div>
          </div>
        </div>
      </div>
    </div>
  );
}
