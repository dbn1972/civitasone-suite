"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FileUpload, type UploadedFileMeta } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const formError = useFormError("attachment");

  // GAP-ESTAB-FILES-DETAIL-02: open an attachment. The estab endpoint enforces
  // classification access + audits the download, then returns the storage key;
  // we exchange it for a short-lived presigned GET at the shared uploads
  // endpoint and open that. A 403/404 shows an honest message, never a dead
  // link.
  async function openAttachment(attId: string) {
    setDownloadingId(attId);
    setDownloadError("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/attachments/${attId}/download`);
      if (!res.ok) {
        setDownloadError(
          res.status === 403
            ? "You are not cleared to open this attachment."
            : "This attachment is unavailable.",
        );
        return;
      }
      const { key } = (await res.json()) as { key?: string };
      if (!key) {
        setDownloadError("This attachment is unavailable.");
        return;
      }
      const urlRes = await fetch(`/api/proxy/v1/admin/uploads/${encodeURIComponent(key)}`);
      if (!urlRes.ok) {
        setDownloadError("This attachment is unavailable.");
        return;
      }
      const { downloadUrl } = (await urlRes.json()) as { downloadUrl?: string };
      if (!downloadUrl) {
        setDownloadError("This attachment is unavailable.");
        return;
      }
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      setDownloadError("This attachment is unavailable.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setMessage("");
    formError.clear();
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
      if (!res.ok) {
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setPending(null);
      setMessage("Attachment uploaded.");
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
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
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => void openAttachment(a.id)}
                  disabled={downloadingId === a.id}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    color: "var(--brand, #2563eb)", textDecoration: "underline", font: "inherit",
                  }}
                >
                  {downloadingId === a.id ? "Opening…" : a.fileName}
                </button>
                <span style={{ color: "var(--mut)", marginInlineStart: 8 }}>
                  {Math.max(1, Math.ceil((a.size || 0) / 1024))} KB · {a.uploadedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {downloadError ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: "0 0 12px" }}>{downloadError}</p>
        ) : null}
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
          <Button type="submit" variant="ghost" disabled={busy || !pending}>Add attachment</Button>
        </form>
        {message ? <p style={{ fontSize: 13, color: "var(--good)", margin: "8px 0 0" }}>{message}</p> : null}
      </div>
    </div>
  );
}
