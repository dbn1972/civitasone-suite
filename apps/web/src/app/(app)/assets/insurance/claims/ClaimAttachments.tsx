"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ds";
import { formatFileSize, type ClaimAttachment } from "./attachments";

/**
 * Read-only list of a claim's supporting documents. A download link is minted on demand through the
 * admin uploads endpoint (a short-lived signed URL), so no file URL is stored or exposed up front.
 */
export function ClaimAttachments({ attachments = [] }: { attachments?: ClaimAttachment[] }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function open(a: ClaimAttachment) {
    setBusyKey(a.key);
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/uploads/${encodeURIComponent(a.key)}`);
      const body = res.ok ? ((await res.json().catch(() => null)) as { downloadUrl?: unknown } | null) : null;
      if (!body || typeof body.downloadUrl !== "string") {
        setError(`Couldn't open ${a.fileName}. Please try again.`);
        return;
      }
      window.open(body.downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError(`Couldn't open ${a.fileName}. Please try again.`);
    } finally {
      setBusyKey(null);
    }
  }

  if (attachments.length === 0) return <span>—</span>;
  return (
    <div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {attachments.map((a) => (
          <li key={a.key} style={{ marginBottom: 4 }}>
            {a.fileName} <span style={{ color: "var(--ink2)", fontSize: 12 }}>({formatFileSize(a.size)})</span>{" "}
            <Button type="button" size="sm" variant="ghost" disabled={busyKey === a.key} aria-label={`Open ${a.fileName}`} onClick={() => void open(a)}>
              {busyKey === a.key ? "Opening…" : "Open"}
            </Button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert" style={{ color: "var(--bad)", fontSize: 12, margin: "6px 0 0" }}>{error}</p> : null}
    </div>
  );
}
