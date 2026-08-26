'use client';

import { useEffect, useState } from "react";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { FileUpload } from "../../../../../_components/ds";

type TenderDoc = {
  id: string;
  docType: string;
  title: string;
  storageRef: string;
  mimeType?: string;
  sizeBytes?: string;
  createdAt?: string;
};

const DOC_TYPES = ["nit", "bid_form", "technical_spec", "financial_spec", "corrigendum", "other"] as const;

function formatBytes(bytes: string | number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  const n = typeof bytes === "number" ? bytes : parseInt(bytes, 10);
  if (isNaN(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return Math.round(n / 1024 / 1024) + " MB";
}

export default function TenderDocumentsPage({ params }: { params: { id: string } }) {
  const [docs, setDocs] = useState<TenderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<string>("other");
  // Set once FileUpload's presigned S3 upload actually completes (see
  // onUploaded below) — this is the durable pointer we persist, never the
  // file's raw bytes.
  const [fileKey, setFileKey] = useState("");
  const [fileUploadNonce, setFileUploadNonce] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/procurement/tenders/" + params.id + "/documents");
      const json = await res.json() as { data?: TenderDoc[] };
      setDocs(Array.isArray(json.data) ? json.data : []);
    } catch {
      setError("Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [params.id]);

  // L2 fix: storageRef is now a real S3 object key (see handleSave below),
  // not a URL — it was never directly linkable even before this fix (the old
  // "base64:name:truncatedcontent" value wasn't a valid href either). Resolve
  // it to a short-lived presigned GET URL via the same admin-uploads service
  // FileUpload's presign call uses, then navigate there.
  async function handleDownload(storageRef: string, docId: string) {
    setDownloadError("");
    setDownloadingId(docId);
    try {
      const res = await fetch("/api/proxy/v1/admin/uploads/" + encodeURIComponent(storageRef));
      if (!res.ok) {
        setDownloadError((await res.text()) || "Could not prepare the download link.");
        return;
      }
      const { downloadUrl } = await res.json() as { downloadUrl?: string };
      if (!downloadUrl) {
        setDownloadError("Could not prepare the download link.");
        return;
      }
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Network error preparing the download.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !fileKey) {
      setSaveMsg("Title and an uploaded file are required.");
      return;
    }
    setSaving(true);
    setSaveMsg("");
    try {
      // L2/L3 fix: this used to base64-encode the whole file client-side and
      // then TRUNCATE it to 200 characters before storing that fragment as
      // storageRef ("base64:" + file.name + ":" + base64.slice(0, 200)) — so
      // any real file was silently corrupted (undownloadable) while the UI
      // still said "Document uploaded successfully." FileUpload above does a
      // real presigned upload to S3 (ds/FileUpload.tsx, the same component
      // works/execution/photos/new/page.tsx uses) and only sets fileKey once
      // that upload has actually completed; storageRef is that real S3 key,
      // not a hand-rolled encoding of the file content.
      const res = await fetch("/api/proxy/v1/procurement/tenders/" + params.id + "/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType,
          title: title.trim(),
          storageRef: fileKey,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        setSaveMsg(t || "Save failed");
        return;
      }
      setSaveMsg("Document uploaded.");
      setTitle(""); setFileKey(""); setDocType("other");
      setFileUploadNonce((n) => n + 1); // remounts FileUpload to clear its own "done" state
      void load();
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Upload error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <a href={"/procurement/tenders/" + params.id} className="btn" style={{ fontSize: 13 }}>← Back to Tender</a>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)", margin: 0 }}>Tender Documents</h1>
          <p style={{ color: "var(--ink2)", fontSize: 12, margin: 0 }}>Tender ID: <span className="mono" style={{ fontSize: 11 }}>{params.id}</span></p>
        </div>
        {error ? <DataSourceBadge source="error" message="Couldn't load documents — showing nothing" /> : null}
      </div>

      {/* Upload form */}
      <form onSubmit={(e) => void handleSave(e)} className="card pad" style={{ marginBottom: 20 }} noValidate>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Upload document</h2>
        <div className="fields">
          <div className="field">
            <label className="label" htmlFor="doc-title">Title *</label>
            <input id="doc-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} style={{ minHeight: 44 }} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="doc-type">Document type</label>
            <select id="doc-type" className="inp" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ minHeight: 44 }}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <FileUpload
              key={fileUploadNonce}
              category="document"
              label="File *"
              maxSizeMb={25}
              onUploaded={(key) => setFileKey(key)}
            />
          </div>
        </div>
        {saveMsg ? <p role={saveMsg === "Document uploaded." ? "status" : "alert"} style={{ marginTop: 8, fontSize: 13, color: saveMsg === "Document uploaded." ? "var(--good)" : "var(--bad)" }}>{saveMsg}</p> : null}
        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn primary" disabled={saving || !fileKey} style={{ minHeight: 44 }}>
            {saving ? "Saving…" : "Save document"}
          </button>
        </div>
      </form>

      {/* Document list */}
      <div className="card">
        {downloadError ? <p role="alert" style={{ margin: 0, padding: "10px 16px 0", fontSize: 13, color: "var(--bad)" }}>{downloadError}</p> : null}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Type</th>
                <th scope="col">Size</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "var(--ink2)" }}>Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "var(--bad)" }}>{error}</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "var(--ink2)" }}>No documents uploaded yet.</td></tr>
              ) : docs.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.title}</td>
                  <td><span style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 3, padding: "1px 6px", fontSize: 11 }}>{doc.docType}</span></td>
                  <td>{formatBytes(doc.sizeBytes)}</td>
                  <td style={{ fontSize: 12, color: "var(--ink2)" }}>{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void handleDownload(doc.storageRef, doc.id)}
                      disabled={downloadingId === doc.id}
                      className="btn"
                      style={{ fontSize: 12, padding: "2px 10px" }}
                    >
                      {downloadingId === doc.id ? "Preparing…" : "Download"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
