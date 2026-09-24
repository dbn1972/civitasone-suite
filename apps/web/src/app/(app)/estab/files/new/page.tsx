"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, PageHeader, Term } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

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
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const formError = useFormError("file");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    formError.clear();
    try {
      // Do NOT invent a file number on the client — the gapless CSMOP file
      // number is allocated server-side (per section + year). Sending a random
      // one both showed the officer a wrong number and risked persisting it.
      const payload = {
        subject,
        dept: department || "ADMIN",
        classification: CLASS_MAP[classification] ?? "public",
        // SECURITY: no officer placeholder — currentWith is intentionally
        // omitted so the server defaults it to the authenticated actor
        // creating this file (never a client-suppliable id).
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
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        setToast({
          type: "success",
          message: "File created with an opening yellow note. Opening it now…",
        });
        if (body.id) {
          setTimeout(() => router.push(`/estab/files/${body.id}`), 800);
        }
      } else {
        setToast({
          type: "error",
          message: (await formError.fromResponse(res, "save")).message,
        });
      }
    } catch {
      setToast({ type: "error", message: formError.fromException("save").message });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Create File"
        subtitle={
          <>
            Opens a new <Term name="eOffice" /> digital file with an initial
            yellow note.
          </>
        }
        back="/estab/list"
        help="estab"
      />

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
        <div className="card-h">
          <h3>File details</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="fields">
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="subject" className="l">
                Subject <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="dakNo" className="l">
                Linked <Term name="DAK" /> No (optional)
              </label>
              <input
                id="dakNo"
                type="text"
                value={dakNo}
                onChange={(e) => setDakNo(e.target.value)}
                placeholder="DAK/2026/001"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="parentFileId" className="l">
                Parent file ID (part-file, optional)
              </label>
              <input
                id="parentFileId"
                type="text"
                value={parentFileId}
                onChange={(e) => setParentFileId(e.target.value)}
                placeholder="UUID of main file"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="classification" className="l">
                Classification
              </label>
              <select
                id="classification"
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <option value="unclassified">Unclassified</option>
                <option value="restricted">Restricted</option>
                <option value="confidential">Confidential</option>
                <option value="secret">Secret</option>
                <option value="top_secret">Top Secret</option>
              </select>
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="department" className="l">
                Department
              </label>
              <input
                id="department"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="initialNote" className="l">
                Initial yellow note
              </label>
              <textarea
                id="initialNote"
                value={initialNote}
                onChange={(e) => setInitialNote(e.target.value)}
                rows={4}
                placeholder="Opening yellow note on note sheet"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #fde047",
                  borderRadius: 8,
                  fontSize: 13,
                  background: "#fefce8",
                  resize: "vertical",
                }}
              />
            </div>
          </div>
          <div
            className="pad"
            style={{
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 8,
            }}
          >
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create File"}
            </Button>
            <a href="/estab/list" className="btn ghost">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
