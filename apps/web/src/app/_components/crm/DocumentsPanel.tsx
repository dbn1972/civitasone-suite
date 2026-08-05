"use client";
/**
 * DocumentsPanel — BRD §7.12 DM-001 (upload / list / version / download /
 * delete) + DM-002 verify + DM-003 storage-provider indicator, for one record.
 *
 * Upload is the three-step presign → PUT-to-storage → confirm flow. The direct
 * PUT is the ONLY raw fetch (it targets the storage provider, not our API).
 * Every list/count is gated on source==="error" → the saved-info badge; we never
 * fabricate an empty list on a failed load. An infected file shows a warning and
 * NEVER offers a download. Delete + verify-reject go through ConfirmDialog.
 * Scan / verification status is announced to assistive tech via aria-live.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import { formatIndianDate } from "@/lib/formatters";
import {
  getDocuments,
  getDocumentTypes,
  presignUpload,
  uploadToStorage,
  confirmDocument,
  getDownloadUrl,
  deleteDocument,
  verifyDocument,
  buildChains,
  isDownloadable,
  SCAN_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
  STORAGE_PROVIDER_LABELS,
  type Document,
  type DocumentChain,
  type DocumentType,
  type SubjectType,
  type DmSource,
  type ScanStatus,
} from "@/lib/crm/documents";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

function fmtSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SCAN_PILL: Record<ScanStatus, { cls: string; icon: string }> = {
  pending: { cls: "warn", icon: "⏳" },
  clean: { cls: "good", icon: "✓" },
  infected: { cls: "bad", icon: "⚠️" },
  error: { cls: "warn", icon: "!" },
};

function ScanBadge({ status }: { status: ScanStatus }) {
  const p = SCAN_PILL[status];
  return (
    <span className={`pill ${p.cls}`} role="status" aria-label={`Scan status: ${SCAN_STATUS_LABELS[status]}`}>
      <span aria-hidden="true">{p.icon} </span>
      {SCAN_STATUS_LABELS[status]}
    </span>
  );
}

interface Props {
  subjectType: SubjectType;
  subjectId: string;
  /** When true, expose the DM-002 verify/reject action (config/admin surface). */
  canVerify?: boolean;
}

export function DocumentsPanel({ subjectType, subjectId, canVerify = false }: Props) {
  const [chains, setChains] = useState<DocumentChain[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [source, setSource] = useState<DmSource | "loading">("loading");
  const [typesSource, setTypesSource] = useState<DmSource | "loading">("loading");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("");
  const [supersedesId, setSupersedesId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<Document | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const fileInputId = useId();
  const titleId = useId();
  const typeId = useId();

  const load = useCallback(
    async (isLive: () => boolean = () => true) => {
      setSource("loading");
      const [docsRes, typesRes] = await Promise.all([getDocuments(subjectType, subjectId), getDocumentTypes()]);
      if (!isLive()) return;
      setChains(buildChains(docsRes.data));
      setTypes(typesRes.data.filter((t) => t.enabled && (t.appliesTo.length === 0 || t.appliesTo.includes(subjectType))));
      // The document list is the source of truth for this panel's honesty; the
      // type list is tracked separately so an empty select can be told apart
      // from a failed types fetch (see the note near the select).
      setSource(docsRes.source);
      setTypesSource(typesRes.source);
    },
    [subjectType, subjectId],
  );

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    const finalTitle = title.trim() || file.name;
    setBusy(true);
    try {
      const mime = file.type || "application/octet-stream";
      const { uploadUrl, storageKey } = await presignUpload({ subjectType, subjectId, filename: file.name, mimeType: mime });
      await uploadToStorage(uploadUrl, file, mime);
      await confirmDocument({
        subjectType,
        subjectId,
        ...(docType ? { docType } : {}),
        title: finalTitle,
        filename: file.name,
        storageKey,
        mimeType: mime,
        sizeBytes: file.size,
        ...(supersedesId ? { supersedesId } : {}),
      });
      setMessage(
        supersedesId
          ? `New version of “${finalTitle}” uploaded. It will be scanned before it can be downloaded.`
          : `“${finalTitle}” uploaded. It will be scanned before it can be downloaded.`,
      );
      setTitle("");
      setDocType("");
      setSupersedesId("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The document could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(doc: Document) {
    setError("");
    try {
      const url = await getDownloadUrl(doc.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The download link could not be prepared.");
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await deleteDocument(id);
      setMessage("Document deleted.");
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The document could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(doc: Document, status: "verified" | "rejected", reason?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await verifyDocument(doc.id, status, reason);
      setMessage(status === "verified" ? `“${doc.title}” marked verified.` : `“${doc.title}” rejected.`);
      setConfirmReject(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The verification could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Documents</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* -------------------------------------------------- uploader -- */}
        <form onSubmit={onUpload} aria-labelledby={headingId} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label htmlFor={titleId} style={labelStyle}>Title</label>
              <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" style={inputStyle} />
            </div>
            <div>
              <label htmlFor={typeId} style={labelStyle}>Document type</label>
              <select id={typeId} value={docType} onChange={(e) => setDocType(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {types.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}{t.mandatory ? " (required)" : ""}
                  </option>
                ))}
              </select>
              {typesSource === "error" ? (
                <p role="status" style={{ margin: "4px 0 0", fontSize: 11, color: "#b42318", display: "flex", alignItems: "center", gap: 6 }}>
                  The document-type list could not be loaded, so no types are shown. <DataSourceBadge source="error" />
                </p>
              ) : null}
            </div>
          </div>
          {supersedesId ? (
            <p role="status" style={{ margin: 0, fontSize: 13, color: "#4f46e5" }}>
              Uploading a new version.{" "}
              <button type="button" className="btn ghost" style={{ minHeight: 28, padding: "2px 8px" }} onClick={() => setSupersedesId("")}>
                Cancel
              </button>
            </p>
          ) : null}
          <div>
            <label htmlFor={fileInputId} style={labelStyle}>File</label>
            <input id={fileInputId} ref={fileRef} type="file" aria-describedby={`${fileInputId}-hint`} style={{ fontSize: 13 }} />
            <p id={`${fileInputId}-hint`} style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
              Uploaded securely to storage — the file never passes through the server, and it is scanned before it can be downloaded.
            </p>
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Uploading…" : supersedesId ? "Upload new version" : "Upload document"}
            </button>
          </div>
          {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
        </form>

        {/* ------------------------------------------------------ list -- */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {source === "loading" ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading documents…</p>
          ) : source === "error" ? (
            <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              — Documents unavailable right now. <DataSourceBadge source="error" />
            </p>
          ) : chains.length === 0 ? (
            <EmptyState icon="📎" title="No documents yet" message="Upload the first attachment for this record above." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }} aria-label="Documents">
              {chains.map((chain) => {
                const doc = chain.current;
                const infected = doc.scanStatus === "infected";
                const open = expanded[doc.id] ?? false;
                return (
                  <li key={doc.id} className="card" style={{ padding: 12, boxShadow: "none", border: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {doc.title}
                          {chain.versions.length > 1 ? <span className="pill info">v{doc.version}</span> : null}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {doc.filename}
                          {fmtSize(doc.sizeBytes) ? <> · {fmtSize(doc.sizeBytes)}</> : null}
                          {doc.createdAt ? <> · {formatIndianDate(doc.createdAt)}</> : null}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                          <ScanBadge status={doc.scanStatus} />
                          <span className={`pill ${doc.verificationStatus === "verified" ? "good" : doc.verificationStatus === "rejected" ? "bad" : "info"}`}>
                            {VERIFICATION_STATUS_LABELS[doc.verificationStatus]}
                          </span>
                          {/* DM-003 storage-provider indicator */}
                          <span
                            className="pill info"
                            title={doc.storageProvider === "s3" ? "Stored in secure object storage" : "Stored outside primary object storage"}
                          >
                            {STORAGE_PROVIDER_LABELS[doc.storageProvider]}
                          </span>
                          {doc.expiryDate ? <span className="pill warn">Expires {formatIndianDate(doc.expiryDate)}</span> : null}
                        </div>
                        {infected ? (
                          <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "#b42318" }}>
                            ⚠️ This file was flagged by the malware scan. It cannot be downloaded.
                          </p>
                        ) : doc.scanStatus === "pending" ? (
                          <p role="status" aria-live="polite" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                            ⏳ Scan in progress — the file can be downloaded once it is confirmed clean.
                          </p>
                        ) : doc.scanStatus === "error" ? (
                          <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "#b42318" }}>
                            The malware scan could not complete, so this file cannot be downloaded.
                          </p>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                        {isDownloadable(doc) ? (
                          <button type="button" className="btn ghost" style={{ minHeight: 36 }} onClick={() => onDownload(doc)}>
                            Download
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn ghost"
                          style={{ minHeight: 36 }}
                          onClick={() => setSupersedesId(doc.id)}
                        >
                          New version
                        </button>
                        {canVerify ? (
                          <>
                            <button
                              type="button"
                              className="btn ghost"
                              style={{ minHeight: 36 }}
                              disabled={busy || doc.verificationStatus === "verified"}
                              onClick={() => onVerify(doc, "verified")}
                            >
                              Verify
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              style={{ minHeight: 36 }}
                              disabled={busy || doc.verificationStatus === "rejected"}
                              onClick={() => setConfirmReject(doc)}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                        <button type="button" className="btn danger" style={{ minHeight: 36 }} onClick={() => setConfirmDeleteId(doc.id)}>
                          Delete
                        </button>
                      </div>
                    </div>

                    {chain.versions.length > 1 ? (
                      <div style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="btn ghost"
                          style={{ minHeight: 28, padding: "2px 8px", fontSize: 12 }}
                          aria-expanded={open}
                          onClick={() => setExpanded((prev) => ({ ...prev, [doc.id]: !open }))}
                        >
                          {open ? "Hide" : "Show"} version history ({chain.versions.length})
                        </button>
                        {open ? (
                          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }} aria-label={`Version history for ${doc.title}`}>
                            {chain.versions.map((v) => (
                              <li key={v.id} style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <span className="pill info">v{v.version}</span>
                                {v.filename}
                                {v.createdAt ? <> · {formatIndianDate(v.createdAt)}</> : null}
                                <ScanBadge status={v.scanStatus} />
                                {isDownloadable(v) ? (
                                  <button type="button" className="btn ghost" style={{ minHeight: 26, padding: "1px 6px" }} onClick={() => onDownload(v)}>
                                    Download
                                  </button>
                                ) : (
                                  <span role={v.scanStatus === "pending" ? "status" : "alert"} style={{ fontStyle: "italic" }}>
                                    {v.scanStatus === "pending"
                                      ? "download available after scan"
                                      : "download unavailable"}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete this document?"
        description="The document and its version history reference will be removed. This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => confirmDeleteId && onDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <ConfirmDialog
        open={confirmReject !== null}
        title="Reject this document?"
        description="Give a short reason. The uploader will see the document was rejected."
        confirmLabel="Reject document"
        danger
        requireReason
        reasonLabel="Reason for rejection"
        busy={busy}
        onConfirm={(reason) => confirmReject && onVerify(confirmReject, "rejected", reason)}
        onCancel={() => setConfirmReject(null)}
      />
    </div>
  );
}
