"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * Per-file actions for the Document Library (GAP-DOCUMENTS-LIBRARY-02).
 *
 * Delete is a confirmed, server-side SOFT delete (the document-service
 * DELETE /v1/documents/files/:id handler sets deleted_at + status and emits an
 * audit event); the row then disappears on refresh because deleted files are
 * hidden by default. Download/Rename are intentionally NOT offered here: the
 * document-service `files` module exposes no download-URL or rename endpoint
 * today, and metadata-only records carry no stored content — adding dead
 * controls would repeat the very gap this batch is fixing. See the batch's
 * HUMAN REVIEW note.
 */
export function FileActions({ fileId, name, status }: { fileId: string; name: string; status: string }) {
  const router = useRouter();
  const formError = useFormError("file");
  const [error, setError] = useState<string | null>(null);

  if (status === "deleted") {
    return <span style={{ color: "var(--ink2)", fontSize: 13 }}>Deleted</span>;
  }

  async function remove(): Promise<void> {
    setError(null);
    const res = await fetch(`/api/v1/documents/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    if (!res.ok) {
      const human = await formError.fromResponse(res, "save");
      setError(human.message);
      throw new Error(human.message);
    }
    router.refresh();
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <ActionButton
        label="Delete"
        className="btn danger"
        danger
        confirmTitle="Delete this file?"
        confirmDescription={`"${name}" will be removed from the library. This is a soft delete and is recorded in the audit trail.`}
        confirmLabel="Delete"
        onConfirm={remove}
      />
      {error && <span role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{error}</span>}
    </div>
  );
}
