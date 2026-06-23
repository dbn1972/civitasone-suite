"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DEFAULT_OFFICER = "00000000-0000-0000-0000-000000000099";

const CLASS_MAP: Record<string, string> = {
  unclassified: "public",
  restricted: "confidential",
  confidential: "confidential",
  secret: "secret",
  top_secret: "top_secret",
};

export default function NewFilePage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [classification, setClassification] = useState("unclassified");
  const [department, setDepartment] = useState("ADMIN");
  const [initialNote, setInitialNote] = useState("");
  const [dakNo, setDakNo] = useState("");
  const [parentFileId, setParentFileId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const year = new Date().getFullYear();
      const fileNo = `F/${year}/${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const payload = {
        fileNo,
        subject,
        dept: department || "ADMIN",
        classification: CLASS_MAP[classification] ?? "public",
        currentWith: DEFAULT_OFFICER,
        initialNote: initialNote || undefined,
        dakNo: dakNo || undefined,
        parentFileId: parentFileId.trim() || undefined,
      };
      const res = await fetch("/api/proxy/v1/estab/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        const body = await res.json().catch(() => ({})) as { id?: string };
        setToast({ type: "success", message: `File ${fileNo} created with yellow note.` });
        if (body.id) {
          setTimeout(() => router.push(`/estab/files/${body.id}`), 800);
        }
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setToast({ type: "error", message: body.message ?? `Error ${res.status}` });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <>
      <a className="back" href="/estab/list">← Back</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <div>
          <h1>Create File</h1>
          <div className="sub">Opens a new eOffice digital file with an initial yellow note.</div>
        </div>
      </div>

      {toast && (
        <div
          className="banner"
          style={{
            background: toast.type === "success" ? "#ecfdf3" : "#fef2f2",
            border: `1px solid ${toast.type === "success" ? "#6ee7b7" : "#fca5a5"}`,
            color: toast.type === "success" ? "#065f46" : "#991b1b",
            borderRadius: 12,
            padding: "13px 16px",
            marginBottom: 18,
            fontSize: 13,
          }}
        >
          {toast.message}
        </div>
      )}

      <div className="card">
        <div className="card-h"><h3>File details</h3></div>
        <form onSubmit={handleSubmit}>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="subject" className="l">Subject <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="dakNo" className="l">Linked DAK No (optional)</label>
              <input id="dakNo" type="text" value={dakNo} onChange={(e) => setDakNo(e.target.value)} placeholder="DAK/2026/001" style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="parentFileId" className="l">Parent file ID (part-file, optional)</label>
              <input id="parentFileId" type="text" value={parentFileId} onChange={(e) => setParentFileId(e.target.value)} placeholder="UUID of main file" style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="classification" className="l">Classification</label>
              <select id="classification" value={classification} onChange={(e) => setClassification(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}>
                <option value="unclassified">Unclassified</option>
                <option value="restricted">Restricted</option>
                <option value="confidential">Confidential</option>
                <option value="secret">Secret</option>
                <option value="top_secret">Top Secret</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="department" className="l">Department</label>
              <input id="department" type="text" value={department} onChange={(e) => setDepartment(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="initialNote" className="l">Initial yellow note</label>
              <textarea id="initialNote" value={initialNote} onChange={(e) => setInitialNote(e.target.value)} rows={4} placeholder="Opening yellow note on note sheet" style={{ width: "100%", padding: "8px 12px", border: "1px solid #fde047", borderRadius: 8, fontSize: 13, background: "#fefce8", resize: "vertical" }} />
            </div>
          </div>
          <div className="pad" style={{ borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
            <button type="submit" className="btn primary" disabled={submitting}>{submitting ? "Creating…" : "Create File"}</button>
            <a href="/estab/list" className="btn ghost">Cancel</a>
          </div>
        </form>
      </div>
    </>
  );
}
