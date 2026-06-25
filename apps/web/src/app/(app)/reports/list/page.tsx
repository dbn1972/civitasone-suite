import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportJobs } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";

export default async function ReportsListPage() {
  const { data: jobs, source } = await getReportJobs();

  const total = jobs.length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Report Jobs"
        subtitle="All report generation jobs and their status."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <Link href="/reports/list/new" className="btn primary">+ New Report</Link>
          </>
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
          <div className="empty-state">
            <div className="ic">📋</div>
            <h4>No report jobs found</h4>
            <p>Jobs will appear here once generated.</p>
          </div>
        ) : (
          <table className="tbl" aria-label="Report jobs">
            <thead>
              <tr>
                <th>Report Name</th>
                <th>Module</th>
                <th>Requested By</th>
                <th>Format</th>
                <th>Status</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="clickable">
                  <td>
                    <Link href={`/reports/${j.id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>
                      {j.reportName}
                    </Link>
                  </td>
                  <td>{j.module}</td>
                  <td>{j.requestedBy}</td>
                  <td>{j.format}</td>
                  <td><StatusPill status={j.status} /></td>
                  <td>
                    {j.status === "completed" && j.downloadUrl ? (
                      <a href={j.downloadUrl} target="_blank" rel="noopener noreferrer"
                        style={{ color: "var(--primary)", fontSize: "13px" }}>
                        Download
                      </a>
                    ) : (
                      <span style={{ color: "#98a2b3" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
