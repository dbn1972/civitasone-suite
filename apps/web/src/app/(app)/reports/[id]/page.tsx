import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportJobById } from "../../../_data/loaders";
import { DataTable, EmptyState, PageHeader, StatusPill } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export default async function ReportDetailPage({ params }: { params: { id: string } }) {
  const { data: job, source } = await getReportJobById(params.id);

  if (!job) {
    return (
      <div className="wrap">
        {source === "error" && <DataSourceBadge source={source} />}
        <PageHeader title="Report not found" back="/reports/list" />
        <EmptyState icon="📋" title="Report job not found" message="The job may have been deleted or the ID is incorrect." />
      </div>
    );
  }

  const displayColumns = job.columns.length > 0
    ? job.columns
    : job.rows.length > 0
      ? Object.keys(job.rows[0])
      : [];

  const visibleRows = job.rows.slice(0, 100);

  type DataRow = Record<string, unknown>;

  const tableRows: DataRow[] = visibleRows.map((row) => {
    const mapped: DataRow = {};
    for (const col of displayColumns) {
      mapped[col] = row[col] ?? "—";
    }
    return mapped;
  });

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title={job.reportName}
        subtitle={`${job.module} · Requested by ${job.requestedBy}`}
        back="/reports/list"
        actions={
          job.status === "completed" && job.downloadUrl ? (
            <a href={job.downloadUrl} target="_blank" rel="noopener noreferrer" className="btn primary">
              Download report
            </a>
          ) : undefined
        }
      />

      <div className="grid g-4" style={{ marginBottom: "18px" }}>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Status</div>
          <div className="val" style={{ marginTop: "6px" }}>
            <StatusPill status={job.status} />
          </div>
        </div>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Format</div>
          <div className="val" style={{ marginTop: "6px", textTransform: "uppercase", fontSize: "14px" }}>
            {job.format}
          </div>
        </div>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Requested at</div>
          <div className="val" style={{ marginTop: "6px", fontSize: "14px" }}>{formatIndianDate(job.requestedAt)}</div>
        </div>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Completed at</div>
          <div className="val" style={{ marginTop: "6px", fontSize: "14px" }}>{job.completedAt ? formatIndianDate(job.completedAt) : "—"}</div>
        </div>
      </div>

      {job.parameters && Object.keys(job.parameters).length > 0 && (
        <div className="card" style={{ marginBottom: "18px" }}>
          <div className="card-h"><h3>Parameters</h3></div>
          <div className="pad">
            <div className="fields">
              {Object.entries(job.parameters).map(([k, v]) => (
                <div className="field" key={k}>
                  <div className="lbl">{k}</div>
                  <div className="val">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>Report data</h3>
          {displayColumns.length > 0 && (
            <span style={{ fontSize: "12px", color: "#98a2b3" }}>
              {visibleRows.length.toLocaleString("en-IN")} of {(job.totalCount > 0 ? job.totalCount : job.rows.length).toLocaleString("en-IN")} rows
            </span>
          )}
        </div>
        {displayColumns.length === 0 ? (
          <EmptyState
            icon="📋"
            title={job.status === "completed" ? "No data columns" : "Pending"}
            message={job.status === "completed" ? "No data columns in this report." : "Data will be available once the report completes."}
          />
        ) : (
          <DataTable<DataRow>
            columns={displayColumns.map((col) => ({ key: col as keyof DataRow & string, label: col }))}
            rows={tableRows}
            sortable
            filterable
            pageSize={15}
          />
        )}
      </div>
    </div>
  );
}
