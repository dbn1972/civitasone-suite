import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getEstabFileById } from "../../../../_data/loaders";
import { PageHeader, StatusPill, EmptyState } from "../../../../_components/ds";
import { FileDetailActions } from "./FileDetailActions";
import { FileAttachments } from "./FileAttachments";
import type { EstabFileDetail } from "@civitasone/types";

function noteRowStyle(noteType: string, eSigned: boolean) {
  if (noteType === "green" || eSigned) return { background: "#f0fdf4", borderLeft: "4px solid #16a34a" };
  if (noteType === "yellow") return { background: "#fefce8", borderLeft: "4px solid #eab308" };
  return {};
}

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
              <div className="fld"><div className="l">Currently with</div><div className="v">{file.currentHolder ?? "—"}</div></div>
              {ext.dueBy ? (
                <div className="fld"><div className="l">SLA due by</div><div className="v">{ext.dueBy.slice(0, 10)}</div></div>
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
            {file.noteSheets.length === 0 ? (
              <EmptyState icon="📝" title="No notes yet" message="Add a yellow note to start the noting chain." />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Note</th>
                    <th>Officer</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {file.noteSheets.map((ns, idx) => {
                    const ext = ns as { noteType?: string; noteStatus?: string; eSigned?: boolean };
                    return (
                      <tr key={ns.id} style={noteRowStyle(ext.noteType ?? "yellow", ext.eSigned ?? false)}>
                        <td>{idx + 1}</td>
                        <td>{ns.content}</td>
                        <td>{ns.author}</td>
                        <td>{ext.noteType === "green" ? "Green (approved)" : ext.noteType === "yellow" ? "Yellow (draft)" : ns.type}</td>
                        <td>{ext.noteStatus ?? "—"}{ext.eSigned ? " · e-Signed" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                      <div className="t">→ Officer {m.toOfficerId.slice(0, 8)}</div>
                      <div className="d">{m.movedAt.slice(0, 16).replace("T", " ")}{m.remarks ? ` · ${m.remarks}` : ""}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon="📋" title="No movement yet" message="Forward or refer the file to see trail." />
              )}
            </div>
          </div>

          {file.dispatchHistory.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Outward dispatch</h3></div>
              <table className="tbl">
                <thead><tr><th>To</th><th>When</th><th>Mode</th></tr></thead>
                <tbody>
                  {file.dispatchHistory.map((d) => (
                    <tr key={d.id}>
                      <td>{d.dispatchedTo}</td>
                      <td>{d.timestamp.slice(0, 16).replace("T", " ")}</td>
                      <td>{d.remarks ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
