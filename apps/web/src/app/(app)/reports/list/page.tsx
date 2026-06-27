import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportJobs } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { ReportJobsTable, type JobRow } from "./ReportJobsTable";

export default async function ReportsListPage() {
  const { data: jobs, source } = await getReportJobs();

  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  const rows: JobRow[] = jobs.map((j) => ({
    id: j.id,
    reportName: j.reportName,
    module: j.module,
    requestedBy: j.requestedBy,
    format: j.format,
    statusPill: j.status,
    download: j.status === "completed" && j.downloadUrl ? "Download" : "—",
    downloadUrl: j.downloadUrl ?? null,
  }));

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Report Jobs"
        subtitle="All report generation jobs and their status."
        actions={
          <Link href="/reports/list/new" className="btn primary">+ New Report</Link>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e7f3fb" label="Total Jobs" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} delta={total ? `${Math.round((completed / total) * 100)}%` : undefined} up={completed > 0} />
        <StatCard icon="⚡" iconBg="#fffaeb" label="Running" value={running} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Failed" value={failed} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h"><h3>Report jobs</h3></div>
        {jobs.length === 0 ? (
          <EmptyState icon="📋" title="No report jobs found" message="Jobs will appear here once generated." />
        ) : (
          <ReportJobsTable rows={rows} />
        )}
      </div>
    </div>
  );
}
