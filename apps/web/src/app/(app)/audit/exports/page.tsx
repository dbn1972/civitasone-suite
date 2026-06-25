import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getAuditExports } from "../../../_data/loaders";
import { ExportConsole } from "./ExportConsole";

export default async function AuditExportsPage() {
  const { data: items, source } = await getAuditExports();

  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <span aria-current="page">Compliance Export</span>
      </nav>
      <PageHeader
        title="Compliance Export"
        subtitle="Generate signed, tamper-evident audit exports for regulators."
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <ExportConsole />

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Recent exports</h3></div>
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Export</th>
              <th scope="col">Requested</th>
              <th scope="col">Format</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Download</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.jobType}</td>
                <td>{formatIndianDate(item.requestedAt)}</td>
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
              <tr><td colSpan={5}><div className="empty-state"><div>📤</div><h4>No export jobs</h4><p>Generated exports will appear here.</p></div></td></tr>
            )}
          </tbody>
        </table>
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: "12.5px", color: "#475467" }}>Exports are cryptographically signed (HMAC) with a 7-year retention lock (WORM). Use “Verify integrity” to re-validate an artifact against its stored signature.</div>
        </div>
      </div>
    </main>
  );
}
