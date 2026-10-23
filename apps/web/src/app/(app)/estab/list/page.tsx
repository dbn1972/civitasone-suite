import { getTranslations } from "next-intl/server";
import { getEstabDashboard, getEstabFiles } from "../../../_data/loaders";
import { Alert, PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState, Term } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatDays } from "@/lib/formatters";
import { averagePendencyDays, isClosedStatus } from "@/lib/estab/sla";
import { MASKED_CLASSIFICATIONS } from "@/lib/estab/classification";
import { FilesTable, type FileRow } from "./FilesTable";
import Link from "next/link";

// GAP-ESTAB-LIST-01: classification label map — not raw lowercase/underscore.
const CLASSIFICATION_LABEL: Record<string, string> = Object.fromEntries([
  ["unclassified", "Unclassified"],
  ["restricted", "Restricted"],
  ["confidential", "Confidential"],
  ["secret", "Secret"],
  ["top_secret", "Top Secret"],
]);

// GAP-ESTAB-LIST-01: subjects of secret / top_secret files are masked for everyone (see
// MASKED_CLASSIFICATIONS in lib/estab/classification.ts, shared with the approvals queue) since
// clearance claims are not available in the web session today. When the backend exposes clearance
// per-actor (GET /v1/estab/files/classifications), this can be relaxed web-side.

export default async function EstabFilesListPage() {
  const tFallback = await getTranslations("employeeFallback");
  const t = await getTranslations("estabW2");
  // GAP-ESTAB-DASHBOARD-01/02: the office-wide figures (Active Files, Avg Pendency) come from the
  // same service counts as the dashboard, so a tile with the same name shows the same number. The
  // register page itself holds only one page of rows, so counting them here would disagree.
  const [{ data: files, source }, { data: dash, source: dashSource, status: dashStatus }] = await Promise.all([
    getEstabFiles(),
    getEstabDashboard(),
  ]);
  const errored = source === "error";
  const dashErrored = dashSource === "error";
  // GET /v1/estab/dashboard is gated to estab_officer, estab_admin, section_officer and
  // super_admin, while the register is also open to the Deputy Secretary and audit_officer, who get
  // a 403 there. That is an access boundary, not an outage: their tiles say so and count the loaded
  // rows under a different label, so a figure with the dashboard's name is never a different number.
  const dashRestricted = dashErrored && dashStatus === 403;
  const pending = files.filter((f) => f.status === "pending").length;
  // GAP-ESTAB-LIST-02: "Closed (MTD)" → "Closed" — we don't have closedAt,
  // so the count is all-time closed, not month-to-date. Closed, archived and disposed are all finished.
  const closed = files.filter((f) => isClosedStatus(f.status)).length;
  const loadedActive = files.filter((f) => f.status === "active").length;
  const loadedPendency = averagePendencyDays(files);

  // Restricted viewers still see figures for the rows they can read, under a label that says so.
  const countLoaded = dashRestricted && !errored;
  const noticeKey = dashRestricted ? "listOfficeFiguresRestricted" : "listOfficeFiguresUnavailable";
  const activeTile = !dashErrored
    ? { label: "Active Files", value: dash.filesActive.toLocaleString("en-IN"), hint: t("listActiveFilesHint") }
    : {
        label: countLoaded ? t("listActiveFilesLoaded") : "Active Files",
        value: countLoaded ? loadedActive.toLocaleString("en-IN") : "—",
        hint: t(noticeKey),
      };
  const pendencyTile = !dashErrored
    ? { label: "Avg Pendency", value: `${formatDays(dash.avgPendencyDays)} days`, hint: undefined }
    : {
        label: countLoaded ? t("listAvgPendencyLoaded") : "Avg Pendency",
        value: countLoaded && loadedPendency !== null ? `${formatDays(loadedPendency)} days` : "—",
        hint: t(noticeKey),
      };

  const rows: FileRow[] = files.map((f) => ({
    id: f.id,
    fileNo: f.fileNo,
    // GAP-ESTAB-LIST-01: mask subject for high-classification files.
    subject: MASKED_CLASSIFICATIONS.has(f.classification) ? "[Classified]" : f.subject,
    // GAP-ESTAB-LIST-05: capitalised classification label, not raw lowercase.
    classification: CLASSIFICATION_LABEL[f.classification] ?? f.classification.replace(/_/g, " "),
    classificationRaw: f.classification,
    department: f.department ?? "—",
    createdBy: f.createdBy.trim() || tFallback("unknownEmployee"),
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
          background: "var(--goodbg)",
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
        <span aria-hidden="true">📁</span> <b>eOffice integration.</b> Digital files with signed note sheets, full movement trail — no physical files.
      </div>
      <StatGrid>
        <StatCard icon="📁" tone="good" hint={activeTile.hint} label={activeTile.label} value={activeTile.value} />
        <StatCard icon="⏱" tone="warn" hint={pendencyTile.hint} label={pendencyTile.label} value={pendencyTile.value} />
        <StatCard icon="🟡" tone="warn" label="Pending" value={errored ? "—" : pending.toLocaleString("en-IN")} />
        {/* GAP-ESTAB-LIST-02: label "Closed", not "Closed (MTD)" */}
        <StatCard icon="✅" tone="info" label="Closed" value={errored ? "—" : closed.toLocaleString("en-IN")} />
      </StatGrid>
      {dashErrored && (
        <Alert variant={dashRestricted ? "info" : "warning"} style={{ marginTop: 12 }}>
          {t(noticeKey)}
        </Alert>
      )}
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
