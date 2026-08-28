"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUpload, type UploadedFileMeta } from "../../../../_components/ds";

type Attachment = {
  id: string;
  fileName: string;
  fileType: string;
  size: number;
  uploadedAt: string;
};

type Props = {
  fileId: string;
  attachments: Attachment[];
};

type PendingUpload = {
  storageRef: string;
  meta: UploadedFileMeta;
};

export function FileAttachments({ fileId, attachments }: Props) {
  const router = useRouter();
  // `attachments` is read directly from props (not mirrored into useState) so
  // that after upload() calls router.refresh() and the parent re-fetches the
  // file with the new attachment, this list actually reflects it — a
  // useState(initial) snapshot would freeze at the first mount and never
  // pick up the fresh prop.
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setMessage("");
    try {
      // F2 — real presigned-URL upload flow: fileName/fileType/sizeBytes/
      // storageRef all come from the actual uploaded file (via FileUpload's
      // onUploaded callback), never a typed filename or a fake placeholder.
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: pending.meta.fileName,
          fileType: pending.meta.mimeType || "application/octet-stream",
          sizeBytes: pending.meta.size,
          storageRef: pending.storageRef,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPending(null);
      setMessage("Attachment uploaded.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Attachments</h3></div>
      <div className="pad">
        {attachments.length === 0 ? (
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 12px" }}>No attachments on this file yet.</p>
        ) : (
          <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
            {attachments.map((a) => (
              <li key={a.id}>
                {a.fileName}
                <span style={{ color: "#94a3b8", marginLeft: 8 }}>{a.uploadedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={upload} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          <FileUpload
            category="attachment"
            label="Choose file to attach"
            onUploaded={(key, meta) => setPending({ storageRef: key, meta })}
          />
          {pending ? (
            <p style={{ fontSize: 12, color: "var(--muted, #64748b)", margin: 0 }}>
              Ready to attach: <code style={{ fontSize: 11 }}>{pending.meta.fileName}</code>
              {" "}({Math.max(1, Math.ceil(pending.meta.size / 1024))} KB)
            </p>
          ) : null}
          <button type="submit" className="btn ghost" disabled={busy || !pending}>Add attachment</button>
        </form>
        {message ? <p style={{ fontSize: 13, color: "var(--good)", margin: "8px 0 0" }}>{message}</p> : null}
      </div>
    </div>
  );
}
