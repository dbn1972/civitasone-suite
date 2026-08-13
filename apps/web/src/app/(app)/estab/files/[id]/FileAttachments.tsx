"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

export function FileAttachments({ fileId, attachments: initial }: Props) {
  const router = useRouter();
  const [attachments, setAttachments] = useState(initial);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!fileName.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/files/${fileId}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: fileName.trim(),
          fileType: "application/pdf",
          sizeBytes: 0,
          storageRef: `pending-upload:${fileName.trim()}`,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setFileName("");
      setMessage("Attachment registered.");
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
        <form onSubmit={upload} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="Document name (e.g. Annexure-I.pdf)"
            style={{ flex: 1, minWidth: 200, padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
          />
          <button type="submit" className="btn ghost" disabled={busy}>Add attachment</button>
        </form>
        {message ? <p style={{ fontSize: 13, color: "var(--good)", margin: "8px 0 0" }}>{message}</p> : null}
      </div>
    </div>
  );
}
