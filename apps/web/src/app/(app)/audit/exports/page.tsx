import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, DataTable, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getAuditExports } from "../../../_data/loaders";
import { ExportConsole } from "./ExportConsole";

type ExportRow = {
  id: string;
  jobType: string;
  requestedAt: string;
  format: string;
  status: string;
  downloadUrl?: string;
} & Record<string, unknown>;

export default async function AuditExportsPage() {
  const { data: items, source } = await getAuditExports();

  const rows = items as ExportRow[];

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
        {rows.length === 0 ? (
          <EmptyState icon="📤" title="No export jobs" message="Generated exports will appear here." />
        ) : (
          <DataTable<ExportRow>
            columns={[
              { key: "jobType", label: "Export", render: (item) => <span className="mono">{item.jobType as string}</span> },
              { key: "requestedAt", label: "Requested", render: (item) => formatIndianDate(item.requestedAt as string) },
              {
                key: "format",
                label: "Format",
                render: (item) => <span className="pill info">{(item.format as string).toUpperCase()}</span>,
              },
              {
                key: "status",
                label: "Status",
                render: (item) => {
                  const s = item.status as string;
                  if (s === "completed") return <span className="pill good">Ready</span>;
                  if (s === "processing") return <span className="pill warn">Generating</span>;
                  if (s === "failed") return <span className="pill bad">Failed</span>;
                  return <span className="pill mut">Queued</span>;
                },
              },
              {
                key: "downloadUrl",
                label: "Download",
                sortable: false,
                render: (item) =>
                  item.status === "completed" && item.downloadUrl
                    ? <a href={item.downloadUrl as string} className="lnk" download>Download</a>
                    : <span style={{ color: "#98a2b3" }}>—</span>,
              },
            ]}
            rows={rows}
          />
        )}
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: "12.5px", color: "#475467" }}>Exports are cryptographically signed (HMAC) with a 7-year retention lock (WORM). Use "Verify integrity" to re-validate an artifact against its stored signature.</div>
        </div>
      </div>
    </main>
  );
}
