import { getEstabFileById } from "../../../../_data/loaders";
import { PageHeader, StatusPill, EmptyState, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { formatIndianDate, formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { FileDetailActions } from "./FileDetailActions";
import { FileAttachments } from "./FileAttachments";
import { ScannedDocumentsSection } from "./ScannedDocumentsSection";
import { OfficerName } from "./OfficerName";
import { MovementTimeline } from "./MovementTimeline";

type NoteRow = {
  idx: number;
  content: string;
  authorId: string;
  when: string;
  type: string;
  status: string;
  signedAt?: string | null;
};

type DispatchRow = {
  dispatchedTo: string;
  when: string;
  mode: string;
};

export default async function EstabFileDetailPage({ params }: { params: { id: string } }) {
  const { data: file, source } = await getEstabFileById(params.id);

  // The loader collapses 404, 5xx and network errors all into source:"error",
  // so we cannot claim "not found" — that would tell an officer an existing
  // file was lost during a backend blip. Offer a real retry instead. (Kept
  // as two flat sibling early-returns, rather than nesting the not-found
  // check inside a single `if (!file)`, so the `source === "error"` guard
  // is a direct, statically-visible gate on everything below it — UX-013.)
  if (source === "error" && !file) {
    return (
      <>
        <PageHeader title="File" back="/estab/list" />
        <RefreshErrorState error={toHumanError("load", { area: "file" })} backHref="/estab/list" />
      </>
    );
  }
  if (!file) {
    return (
      <>
        <PageHeader title="File not found" back="/estab/list" />
        <p className="sub">The requested file could not be found.</p>
      </>
    );
  }

  const draftNoting = [...file.noteSheets]
    .filter((n) => n.noteType === "yellow" && n.noteStatus === "draft")
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))[0];

  // dakNo/dueBy/movementHistory are now first-class on EstabFileDetail
  // (GAP-ESTAB-FILES-DETAIL-06) — no ad-hoc casts.
  const ext = file;

  const noteRows: NoteRow[] = [...file.noteSheets]
    .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))
    .map((ns, idx) => {
      const typeLabel = ns.noteType === "green" ? "Green (approved)" : ns.noteType === "yellow" ? "Yellow (draft)" : ns.type;
      return {
        idx: idx + 1,
        content: ns.content,
        authorId: ns.author,
        when: ns.timestamp ? formatIndianDate(ns.timestamp) : "—",
        type: `${typeLabel}${ns.eSigned ? " · e-Signed" : ""}`,
        status: (ns.noteStatus ?? "—").replace(/_/g, " "),
        signedAt: ns.signedAt ?? null,
      };
    });

  const dispatchRows: DispatchRow[] = file.dispatchHistory.map((d) => ({
    dispatchedTo: d.dispatchedTo,
    when: formatIndianDate(d.timestamp),
    mode: d.remarks ?? "—",
  }));

  return (
    <>
      <PageHeader
        title={`${file.fileNo} · ${file.subject}`}
        subtitle={ext.dakNo ? `Linked DAK: ${ext.dakNo}` : "Digital file"}
        back="/estab/list"
        actions={
          <>
            <a
              href={`/api/proxy/v1/estab/files/${file.id}/note-sheet/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn ghost"
              style={{ fontSize: "0.8125rem" }}
            >
              Print note sheet
            </a>
            <StatusPill status={file.status.replace(/_/g, " ")} label={file.status.replace(/_/g, " ")} />
          </>
        }
      />

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>File details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Subject</div><div className="v">{file.subject}</div></div>
              <div className="fld"><div className="l">Department</div><div className="v">{file.department ?? "—"}</div></div>
              <div className="fld"><div className="l">Classification</div><div className="v">{file.classification.replace(/_/g, " ")}</div></div>
              <div className="fld"><div className="l">Currently with</div><div className="v">{file.currentHolder ? <OfficerName id={file.currentHolder} /> : "—"}</div></div>
              {ext.dueBy ? (
                <div className="fld"><div className="l">SLA due by</div><div className="v">{formatIndianDate(ext.dueBy)}</div></div>
              ) : null}
            </div>
          </div>

          <FileDetailActions
            fileId={file.id}
            draftNotingId={draftNoting?.id}
            status={file.status}
          />

          <FileAttachments fileId={file.id} attachments={file.attachments ?? []} />

          <ScannedDocumentsSection fileId={file.id} backHref="/estab/list" />

          <div className="card">
            <div className="card-h"><h3>Note sheet</h3></div>
            {noteRows.length === 0 ? (
              <EmptyState icon="📝" title="No notes yet" message="Add a yellow note to start the noting chain." />
            ) : (
              <DataTable<NoteRow>
                columns={[
                  { key: "idx", label: "#", align: "right" },
                  { key: "content", label: "Note" },
                  { key: "when", label: "When" },
                  { key: "authorId", label: "Officer", render: (r) => (r.authorId ? <OfficerName id={r.authorId} /> : <>—</>) },
                  {
                    key: "type",
                    label: "Type",
                    render: (r) => (
                      <>
                        {r.type}
                        {r.signedAt ? (
                          <span style={{ color: "var(--mut)", marginLeft: 6, fontSize: 12 }}>
                            (signed {formatIndianDateTime(r.signedAt)})
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                  { key: "status", label: "Status", cellType: "status" },
                ]}
                rows={noteRows}
              />
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Movement trail</h3></div>
            <div className="pad">
              {ext.movementHistory?.length ? (
                <MovementTimeline movements={ext.movementHistory} />
              ) : (
                <EmptyState icon="📋" title="No movement yet" message="Forward or refer the file to see trail." />
              )}
            </div>
          </div>

          {dispatchRows.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Outward dispatch</h3></div>
              <DataTable<DispatchRow>
                columns={[
                  { key: "dispatchedTo", label: "To" },
                  { key: "when", label: "When" },
                  { key: "mode", label: "Mode" },
                ]}
                rows={dispatchRows}
              />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
