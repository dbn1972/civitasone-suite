'use client';

import { useEffect, useState } from "react";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";

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
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<string>("other");
  const [file, setFile] = useState<File | null>(null);

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

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !file) {
      setUploadMsg("Title and file are required.");
      return;
    }
    setUploading(true);
    setUploadMsg("");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const storageRef = "base64:" + file.name + ":" + base64.slice(0, 200);
      const res = await fetch("/api/proxy/v1/procurement/tenders/" + params.id + "/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType,
          title: title.trim(),
          storageRef,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        setUploadMsg(t || "Upload failed");
        return;
      }
      setUploadMsg("Document uploaded successfully.");
      setTitle(""); setFile(null); setDocType("other");
      void load();
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : "Upload error");
    } finally {
      setUploading(false);
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
        <DataSourceBadge source={error ? "error" : "api"} />
      </div>

      {/* Upload form */}
      <form onSubmit={(e) => void handleUpload(e)} className="card pad" style={{ marginBottom: 20 }} noValidate>
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
            <label className="label" htmlFor="doc-file">File *</label>
            <input id="doc-file" type="file" className="inp" style={{ minHeight: 44, paddingTop: 10 }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </div>
        </div>
        {uploadMsg ? <p style={{ marginTop: 8, fontSize: 13, color: uploadMsg.startsWith("Document") ? "var(--good)" : "var(--bad)" }}>{uploadMsg}</p> : null}
        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn primary" disabled={uploading} style={{ minHeight: 44 }}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>

      {/* Document list */}
      <div className="card">
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
                    <a href={doc.storageRef} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: 12, padding: "2px 10px" }}>Download</a>
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
