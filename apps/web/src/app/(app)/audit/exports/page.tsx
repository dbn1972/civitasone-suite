import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, EmptyState } from "../../../_components/ds";
import { getAuditExports } from "../../../_data/loaders";
import { ExportConsole } from "./ExportConsole";
import { ExportsTable, type ExportRow } from "./ExportsTable";

export default async function AuditExportsPage() {
  const { data: items, source } = await getAuditExports();

  const rows = items as ExportRow[];

  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
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
        {rows.length === 0 ? (
          <EmptyState icon="📤" title="No export jobs" message="Generated exports will appear here." />
        ) : (
          <ExportsTable rows={rows} />
        )}
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: "12.5px", color: "#475467" }}>Exports are cryptographically signed (HMAC) with a 7-year retention lock (WORM). Use "Verify integrity" to re-validate an artifact against its stored signature.</div>
        </div>
      </div>
    </main>
  );
}
