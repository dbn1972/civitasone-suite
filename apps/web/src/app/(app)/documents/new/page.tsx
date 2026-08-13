"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../_components/ds";

export default function UploadDocumentPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/documents/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(typeof body.message === "string" ? body.message : `HTTP ${res.status}`);
      }
      router.push("/documents/library");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wrap">
      <PageHeader
        title="Upload Document"
        subtitle="Register a new file in the document library."
      />

      <div className="card" style={{ maxWidth: 560, marginTop: 18 }}>
        <div className="card-h"><h3>File Details</h3></div>
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: "var(--r)", background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)", fontSize: 14 }}>
              {error}
            </div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: "var(--ink2)" }}>
            <span>File Name <span style={{ color: "var(--bad)" }}>*</span></span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Budget Report Q3.pdf"
              style={{
                padding: "8px 12px", borderRadius: "var(--r)", border: "1px solid var(--line)",
                background: "var(--bg)", color: "var(--ink)", fontSize: 14,
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: "var(--ink2)" }}>
            <span>Tags (comma-separated)</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. finance, 2025, approved"
              style={{
                padding: "8px 12px", borderRadius: "var(--r)", border: "1px solid var(--line)",
                background: "var(--bg)", color: "var(--ink)", fontSize: 14,
              }}
            />
          </label>

          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
            File content upload (S3/storage) is wired to the backend — attach a file from the library view once the record is created.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? "Saving…" : "Create Record"}
            </button>
            <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
