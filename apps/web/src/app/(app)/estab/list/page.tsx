import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { FilesTable, type FileRow } from "./FilesTable";

export default async function EstabFilesListPage() {
  const { data: files, source } = await getEstabFiles();
  const active = files.filter((f) => f.status === "active").length;
  const pending = files.filter((f) => f.status === "pending").length;
  const closed = files.filter((f) => f.status === "archived" || f.status === "disposed").length;

  // Avg Pendency: compute from createdDate for pending files (days since creation).
  const today = Date.now();
  const pendingFiles = files.filter((f) => f.status === "pending");
  let avgPendencyDisplay = "—";
  if (pendingFiles.length > 0) {
    const totalDays = pendingFiles.reduce((sum, f) => {
      const d = new Date(f.createdDate);
      if (isNaN(d.getTime())) return sum;
      return sum + Math.round((today - d.getTime()) / (1000 * 60 * 60 * 24));
    }, 0);
    const avg = Math.round(totalDays / pendingFiles.length);
    avgPendencyDisplay = `${avg} day${avg === 1 ? "" : "s"}`;
  }

  const rows: FileRow[] = files.map((f) => ({
    id: f.id,
    fileNo: f.fileNo,
    subject: f.subject,
    classification: f.classification.replace(/_/g, " "),
    department: f.department ?? "—",
    createdBy: f.createdBy,
    status: f.status.replace(/_/g, " "),
    statusRaw: f.status,
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Digital File Tracking (eOffice)"
        subtitle="Create, route and track files with note sheets & movement trail."
        actions={
          <>
            <a className="btn ghost" href="/estab/dak">Dak / Receipts</a>
            <a className="btn ghost" href="/estab/dispatch">Dispatch</a>
            <a className="btn ghost" href="/estab/approvals">Approvals</a>
            <a className="btn primary" href="/estab/files/new">+ Create File</a>
          </>
        }
      />
      <div
        className="banner"
        style={{
          background: "#e6f7f5",
          border: "1px solid #99e6da",
          color: "#0f766e",
          borderRadius: 12,
          padding: "13px 16px",
          marginBottom: 18,
          fontSize: 13,
        }}
      >
        <span aria-hidden="true">📁</span> <b>eOffice integration.</b> Digital files with e-sign note sheets, full movement trail and SLA on pendency — no physical files.
      </div>
      <StatGrid>
        <StatCard icon="📁" iconBg="#e6f7f5" label="Active Files" value={active.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fffaeb" label="Avg Pendency" value={avgPendencyDisplay} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="SLA Breached" value={pending.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="Closed (MTD)" value={closed.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {files.length === 0 ? (
          <>
            <div className="card-h">
              <h3>File register &amp; tracking</h3>
            </div>
            <EmptyState icon="📁" title="No files found" message="No eOffice files created yet." />
          </>
        ) : (
          <FilesTable rows={rows} />
        )}
      </div>
    </>
  );
}
