import { getEstabFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState, Term } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatDays } from "@/lib/formatters";
import { pendencyDays } from "@/lib/estab/sla";
import { FilesTable, type FileRow } from "./FilesTable";
import Link from "next/link";

// GAP-ESTAB-LIST-01: classification label map — not raw lowercase/underscore.
const CLASSIFICATION_LABEL: Record<string, string> = {
  unclassified: "Unclassified",
  restricted: "Restricted",
  confidential: "Confidential",
  secret: "Secret",
  top_secret: "Top Secret",
};

// GAP-ESTAB-LIST-01: subjects above 'restricted' are masked for everyone
// since clearance claims are not available in the web session today.
// DECISION: mask subject for secret / top_secret; show a generic placeholder.
// When the backend exposes clearance per-actor (GET /v1/estab/files/classifications),
// this can be relaxed web-side. For now: safest default is mask.
const MASKED_CLASSIFICATIONS = new Set(["secret", "top_secret"]);

export default async function EstabFilesListPage() {
  const { data: files, source } = await getEstabFiles();
  const errored = source === "error";
  const active = files.filter((f) => f.status === "active").length;
  const pending = files.filter((f) => f.status === "pending").length;
  // GAP-ESTAB-LIST-02: "Closed (MTD)" → "Closed" — we don't have closedAt,
  // so the count is all-time closed, not month-to-date.
  const closed = files.filter((f) => f.status === "archived" || f.status === "disposed").length;

  const pendingFiles = files.filter((f) => f.status === "pending");
  let avgPendencyDisplay = "—";
  if (pendingFiles.length > 0) {
    const totalDays = pendingFiles.reduce((sum, f) => {
      const d = pendencyDays(f);
      return d !== null ? sum + d : sum;
    }, 0);
    avgPendencyDisplay = `${formatDays(totalDays / pendingFiles.length)} days`;
  }

  const rows: FileRow[] = files.map((f) => ({
    id: f.id,
    fileNo: f.fileNo,
    // GAP-ESTAB-LIST-01: mask subject for high-classification files.
    subject: MASKED_CLASSIFICATIONS.has(f.classification) ? "[Classified]" : f.subject,
    // GAP-ESTAB-LIST-05: capitalised classification label, not raw lowercase.
    classification: CLASSIFICATION_LABEL[f.classification] ?? f.classification.replace(/_/g, " "),
    classificationRaw: f.classification,
    department: f.department ?? "—",
    createdBy: f.createdBy,
    status: f.status.replace(/_/g, " "),
    statusRaw: f.status,
    // GAP-ESTAB-LIST-03: surface dueDate for overdue detection.
    dueDate: f.dueDate ?? undefined,
  }));

  return (
    <>
      <PageHeader
        title={<>Digital File Tracking <Term name="eOffice" before="(" after=")" /></>}
        subtitle={<>Create, route and track files with <Term name="Note sheet" label="note sheets" /> & movement trail.</>}
        help="estab"
        actions={
          <>
            {/* GAP-ESTAB-LIST-04: "Guided File" is secondary; "Create File" is primary.
                Use next/link (no full-page reload). */}
            <Link className="btn ghost" href="/estab/workspace">Guided File</Link>
            <Link className="btn primary" href="/estab/files/new">+ Create File</Link>
          </>
        }
      />
      {/* GAP-ESTAB-LIST-04: use next/link in the subnav to avoid full-page reloads. */}
      <nav aria-label="Establishment sections" className="subnav">
        <Link href="/estab/inbox">My Desk</Link>
        <Link href="/estab/dak">Dak / Receipts</Link>
        <Link href="/estab/dispatch">Dispatch</Link>
        <Link href="/estab/dfa">DFA</Link>
        <Link href="/estab/approvals">Approvals</Link>
        <Link href="/estab/approval-matrix">Approval Matrix</Link>
        <Link href="/estab/operators">Operators</Link>
        <Link href="/estab/handover">Handover</Link>
        <Link href="/estab/migration">Migration</Link>
        <Link href="/estab/notifications">Notifications</Link>
      </nav>
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
        {/* GAP-ESTAB-LIST-03: removed "and SLA on pendency" — dueDate is now
            shown per-file in the table via a Due column with overdue highlight. */}
        <span aria-hidden="true">📁</span> <b>eOffice integration.</b> Digital files with e-sign note sheets, full movement trail — no physical files.
      </div>
      <StatGrid>
        <StatCard icon="📁" iconBg="#e6f7f5" label="Active Files" value={errored ? "—" : active.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fffaeb" label="Avg Pendency" value={errored ? "—" : avgPendencyDisplay} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="Pending" value={errored ? "—" : pending.toLocaleString("en-IN")} />
        {/* GAP-ESTAB-LIST-02: label "Closed", not "Closed (MTD)" */}
        <StatCard icon="✅" iconBg="#eff6ff" label="Closed" value={errored ? "—" : closed.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <>
            <div className="card-h"><h3>File register &amp; tracking</h3></div>
            <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "file register" })} /></div>
          </>
        ) : files.length === 0 ? (
          <>
            <div className="card-h"><h3>File register &amp; tracking</h3></div>
            <EmptyState icon="📁" title="No files found" message="No eOffice files created yet." />
          </>
        ) : (
          <FilesTable rows={rows} />
        )}
      </div>
    </>
  );
}
