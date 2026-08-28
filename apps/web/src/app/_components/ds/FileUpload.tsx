"use client";

import { useRef, useState } from "react";

/** Real metadata of the file that was just uploaded (from the browser File object). */
export type UploadedFileMeta = {
  fileName: string;
  size: number;
  mimeType: string;
};

/**
 * FileUpload — reusable file upload component that gets a pre-signed URL from
 * the backend, then uploads directly to S3. No file passes through the API server.
 *
 * Usage: <FileUpload category="resume" onUploaded={(key) => setResumeKey(key)} />
 *
 * `onUploaded`'s second argument carries the real fileName/size/mimeType from
 * the browser File object, for callers whose backend record needs them (e.g.
 * an attachment row) — existing callers that only read the key are unaffected.
 */
export function FileUpload({
  category = "attachment",
  accept,
  label = "Upload file",
  maxSizeMb = 10,
  onUploaded,
}: {
  category?: "resume" | "attachment" | "document" | "photo";
  accept?: string;
  label?: string;
  maxSizeMb?: number;
  onUploaded?: (key: string, meta: UploadedFileMeta) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    if (file.size > maxSizeMb * 1024 * 1024) {
      setStatus("error");
      setMessage(`File too large. Maximum ${maxSizeMb}MB.`);
      return;
    }

    setStatus("uploading");
    setMessage("");

    try {
      // 1. Get pre-signed URL
      const presignRes = await fetch("/api/proxy/v1/admin/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, filename: file.name, contentType: file.type }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        setStatus("error");
        setMessage((err as { message?: string }).message || "Could not prepare upload. Try again.");
        return;
      }

      const { uploadUrl, key, headers } = await presignRes.json() as { uploadUrl: string; key: string; headers: Record<string, string> };

      // 2. Upload directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { ...headers },
        body: file,
      });

      if (!uploadRes.ok) {
        setStatus("error");
        setMessage("Upload failed. Please try again.");
        return;
      }

      setStatus("done");
      setMessage(`Uploaded: ${file.name}`);
      onUploaded?.(key, { fileName: file.name, size: file.size, mimeType: file.type });
    } catch {
      setStatus("error");
      setMessage("Network error during upload. Check your connection.");
    }
  }

  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          disabled={status === "uploading"}
          style={{ fontSize: 13 }}
        />
        {status === "uploading" && <span style={{ fontSize: 12, color: "#4f46e5" }}>Uploading…</span>}
        {status === "done" && <span style={{ fontSize: 12, color: "#166534" }}>✅ {message}</span>}
        {status === "error" && <span style={{ fontSize: 12, color: "#b91c1c" }}>❌ {message}</span>}
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#94a3b8" }}>
        Max {maxSizeMb}MB. Uploaded securely — no file passes through the server.
      </p>
    </div>
  );
}
