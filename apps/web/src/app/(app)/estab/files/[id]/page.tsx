import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getEstabFileById } from "../../../../_data/loaders";
import { PageHeader, StatusPill, EmptyState, DataTable } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { FileDetailActions } from "./FileDetailActions";
import { FileAttachments } from "./FileAttachments";
import { OfficerName } from "./OfficerName";
import type { EstabFileDetail } from "@civitasone/types";

type NoteRow = {
  idx: number;
  content: string;
  author: string;
  type: string;
  status: string;
};

type DispatchRow = {
  dispatchedTo: string;
  when: string;
  mode: string;
};

export default async function EstabFileDetailPage({ params }: { params: { id: string } }) {
  const { data: file, source } = await getEstabFileById(params.id);

  if (!file) {
    return (
      <>
        <PageHeader title="File not found" back="/estab/list" />
        <p className="sub">The requested file could not be found.</p>
      </>
    );
  }

  const draftNoting = file.noteSheets.find(
    (n) => (n as { noteType?: string; noteStatus?: string }).noteType === "yellow"
      && (n as { noteStatus?: string }).noteStatus === "draft",
  );

  const ext = file as EstabFileDetail & { dakNo?: string; dueBy?: string; movementHistory?: Array<{ id: string; toOfficerId: string; movedAt: string; remarks?: string | null }> };

  const noteRows: NoteRow[] = file.noteSheets.map((ns, idx) => {
    const n = ns as { noteType?: string; noteStatus?: string; eSigned?: boolean };
    const typeLabel = n.noteType === "green" ? "Green (approved)" : n.noteType === "yellow" ? "Yellow (draft)" : ns.type;
    return {
      idx: idx + 1,
      content: ns.content,
      author: ns.author,
      type: `${typeLabel}${n.eSigned ? " · e-Signed" : ""}`,
      status: (n.noteStatus ?? "—").replace(/_/g, " "),
    };
  });

  const dispatchRows: DispatchRow[] = file.dispatchHistory.map((d) => ({
    dispatchedTo: d.dispatchedTo,
    when: formatIndianDate(d.timestamp),
    mode: d.remarks ?? "—",
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
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

          <div className="card">
            <div className="card-h"><h3>Note sheet</h3></div>
            {noteRows.length === 0 ? (
              <EmptyState icon="📝" title="No notes yet" message="Add a yellow note to start the noting chain." />
            ) : (
              <DataTable<NoteRow>
                columns={[
                  { key: "idx", label: "#", align: "right" },
                  { key: "content", label: "Note" },
                  { key: "author", label: "Officer" },
                  { key: "type", label: "Type" },
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
                <ul className="tl">
                  {ext.movementHistory.map((m, i, arr) => (
                    <li key={m.id} className={i < arr.length - 1 ? "done" : "cur"}>
                      <div className="t"><OfficerName id={m.toOfficerId} prefix="→ " /></div>
                      <div className="d">{formatIndianDate(m.movedAt)}{m.remarks ? ` · ${m.remarks}` : ""}</div>
                    </li>
                  ))}
                </ul>
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
