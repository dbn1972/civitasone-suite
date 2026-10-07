import Link from "next/link";
import { getReportJobs } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { ReportJobsTable, type JobRow } from "./ReportJobsTable";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GAP-REPORTS-LIST-03: report-service returns `requestedBy` as a raw user UUID
 * (or the tenant id as a fallback). Showing a bare UUID in the "Requested By"
 * column is meaningless to a user and leaks an internal id. There is no
 * web-side user-name resolver wired for the report list, so a UUID is rendered
 * as "Unknown user" rather than the raw id; a human-readable value is shown
 * as-is. HUMAN REVIEW: the real fix is for report-service to return
 * `requestedByName` (or a resolver). Per-user row scoping (own vs all) is left
 * as the existing tenant-wide behaviour pending a product decision — see
 * report.
 */
function displayRequestedBy(value: string): string {
  if (!value || UUID_RE.test(value)) return "Unknown user";
  return value;
}

export default async function ReportsListPage() {
  const { data: jobs, source } = await getReportJobs();
  const errored = source === "error";

  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  const rows: JobRow[] = jobs.map((j) => ({
    id: j.id,
    reportName: j.reportName,
    module: j.module,
    requestedBy: displayRequestedBy(j.requestedBy),
    format: j.format,
    statusPill: j.status,
    download: j.status === "completed" && j.downloadUrl ? "Download" : "—",
    downloadUrl: j.downloadUrl ?? null,
  }));

  return (
    <div className="wrap">
      <PageHeader
        title="Report Jobs"
        subtitle="All report generation jobs and their status."
        actions={
          <Link href="/reports/list/new" className="btn primary">+ New Report</Link>
        }
      />

      {/* GAP-REPORTS-LIST-01: on a fetch error the four stats read "—" (StatCard
          renders null as an em dash), not a fabricated 0 above the retry card. */}
      <StatGrid>
        <StatCard icon="📋" tone="info" label="Total Jobs" value={errored ? null : total} />
        <StatCard icon="✅" tone="good" label="Completed" value={errored ? null : completed} delta={errored || !total ? undefined : `${Math.round((completed / total) * 100)}%`} up={completed > 0} />
        <StatCard icon="⚡" tone="warn" label="Running" value={errored ? null : running} />
        <StatCard icon="❌" tone="bad" label="Failed" value={errored ? null : failed} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h"><h3>Report jobs</h3></div>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "report jobs" })} backHref="/reports" />
        ) : jobs.length === 0 ? (
          <EmptyState icon="📋" title="No report jobs found" message="Jobs will appear here once generated." />
        ) : (
          <ReportJobsTable rows={rows} />
        )}
      </div>
    </div>
  );
}
