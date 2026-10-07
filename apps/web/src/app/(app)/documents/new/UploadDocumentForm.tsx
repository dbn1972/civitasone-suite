"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Field, FileUpload, Input, Select, type UploadedFileMeta } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/** A folder option passed down from the Server Component wrapper. */
export type FolderOption = { id: string; name: string; path: string };

const NAME_MAX = 500;
// Executables and scripts a clerk should never register as a document record.
const BLOCKED_EXTENSIONS = ["exe", "bat", "cmd", "com", "msi", "scr", "js", "sh", "ps1"];

function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Client-side validation of the file name (GAP-DOCUMENTS-NEW-03): length cap
 * and a blocked-extension check, mirrored by the server's own zod validation
 * (document-service files/validators.ts) — the server stays authoritative.
 */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a file name.";
  if (trimmed.length > NAME_MAX) return `File name must be ${NAME_MAX} characters or fewer.`;
  const ext = extensionOf(trimmed);
  if (ext && BLOCKED_EXTENSIONS.includes(ext)) return `${ext.toUpperCase()} files cannot be uploaded.`;
  return null;
}

export function UploadDocumentForm({
  folders,
  defaultFolderId,
}: {
  folders: FolderOption[];
  defaultFolderId: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId ?? "");
  const [uploaded, setUploaded] = useState<UploadedFileMeta | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const formError = useFormError("document");

  function handleUploaded(_key: string, meta: UploadedFileMeta) {
    setUploaded(meta);
    setFileError(null);
    if (!name.trim()) setName(meta.fileName);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const nameValidation = validateName(name);
    setNameError(nameValidation);
    const missingFile = !uploaded;
    setFileError(missingFile ? "Select a file to upload." : null);
    if (nameValidation || missingFile) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/documents/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // uploadFileBody declares these optional (not nullable): omit empties.
        body: JSON.stringify({
          name: name.trim(),
          ...(folderId ? { folderId } : {}),
          ...(uploaded?.mimeType ? { mimeType: uploaded.mimeType } : {}),
          ...(typeof uploaded?.size === "number" ? { sizeBytes: uploaded.size } : {}),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      router.push(folderId ? `/documents/library?folderId=${folderId}` : "/documents/library");
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div
          role="alert"
          style={{ padding: "10px 14px", borderRadius: "var(--r)", background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", fontSize: 14 }}
        >
          {error}
        </div>
      )}

      <FileUpload
        category="document"
        label="File *"
        onUploaded={handleUploaded}
      />
      {fileError && (
        <span role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{fileError}</span>
      )}

      <Field label="File Name" required error={nameError ?? undefined}>
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); if (nameError) setNameError(null); }}
          placeholder="e.g. Budget Report Q3.pdf"
          maxLength={NAME_MAX}
        />
      </Field>

      <Field label="Folder">
        <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">Root (no folder)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.path && f.path !== "/" ? f.path : f.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Tags (comma-separated)">
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="e.g. finance, 2025, approved"
        />
      </Field>

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button type="submit" className="btn primary" disabled={submitting}>
          {submitting ? "Saving…" : "Create Record"}
        </button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
