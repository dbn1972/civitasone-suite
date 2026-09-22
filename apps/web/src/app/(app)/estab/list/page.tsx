import { getEstabFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState, Term } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { FilesTable, type FileRow } from "./FilesTable";

export default async function EstabFilesListPage() {
  const { data: files, source } = await getEstabFiles();
  const errored = source === "error";
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
      <PageHeader
        title={<>Digital File Tracking (<Term name="eOffice" />)</>}
        subtitle={<>Create, route and track files with <Term name="Note sheet" label="note sheets" /> & movement trail.</>}
        help="estab"
        actions={
          <>
            <a className="btn primary" href="/estab/workspace">Guided File</a>
            <a className="btn primary" href="/estab/files/new">+ Create File</a>
          </>
        }
      />
      {/* Bug C (fix/tenant-admin-and-establishment-nav): these 10 cross-links
          used to live inside PageHeader's own `actions` slot, wrapping onto
          the same flex row as the 2 real page actions above (Guided File /
          + Create File) with no visual boundary between "go to a related
          section" and "do a thing on this page" -- the exact confusion the
          reported bug described. ds/Tabs.tsx wasn't the right fit for this:
          it's a role="tablist" client-side content-switcher for panels
          within one page, not cross-page navigation -- reusing it here would
          have been an ARIA misuse (a real <nav> of <a>s is the correct
          semantics for links to different routes). Instead: pulled these
          into their own clearly-bounded <nav>, styled via the new `.subnav`
          rule (civitas-ds.css), visually distinct from the actions row. */}
      <nav aria-label="Establishment sections" className="subnav">
        <a href="/estab/inbox">My Desk</a>
        <a href="/estab/dak">Dak / Receipts</a>
        <a href="/estab/dispatch">Dispatch</a>
        <a href="/estab/dfa">DFA</a>
        <a href="/estab/approvals">Approvals</a>
        <a href="/estab/approval-matrix">Approval Matrix</a>
        <a href="/estab/operators">Operators</a>
        <a href="/estab/handover">Handover</a>
        <a href="/estab/migration">Migration</a>
        <a href="/estab/notifications">Notifications</a>
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
        <span aria-hidden="true">📁</span> <b>eOffice integration.</b> Digital files with e-sign note sheets, full movement trail and SLA on pendency — no physical files.
      </div>
      {/* "Pending" (not "SLA Breached"): there is no due-date/SLA field here, so
          this is the count of pending files, not a breach count. Show "—" rather
          than a fabricated 0 when the initial load errors. status-leak-ok (this
          comment's prose was previously matched by the guard's line-based
          literal check, which cannot see that a multi-line JSX comment is still
          a comment past its first line — see UX-016/UX-020 in the gap report). */}
      <StatGrid>
        <StatCard icon="📁" iconBg="#e6f7f5" label="Active Files" value={errored ? "—" : active.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fffaeb" label="Avg Pendency" value={errored ? "—" : avgPendencyDisplay} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="Pending" value={errored ? "—" : pending.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="Closed (MTD)" value={errored ? "—" : closed.toLocaleString("en-IN")} />
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
