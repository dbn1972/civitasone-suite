"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { KNOWLEDGE_CATEGORIES } from "../../_data/categories";

/**
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-03: category is now a <select> from a shared
 *   constant list, preventing typos that would fall out of repository segment
 *   filters.
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-04: renamed "Publish document" to "Add document"
 *   because the create endpoint sets status="draft", not "published". The governed
 *   publish lifecycle is for policies (policies/[id]/PolicyActions).
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-06: removed inline background:'#fff' that broke
 *   dark mode. The .field class already sets background: var(--panel).
 */
export function CreateDocumentForm({
  defaultCategory = "",
  backHref = "/knowledge/repository",
}: {
  defaultCategory?: string;
  backHref?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  // GAP-KNOWLEDGE-DOCUMENTS-NEW-01: accessLevel select, defaults to least-privilege "internal"
  const [accessLevel, setAccessLevel] = useState<"public" | "internal" | "restricted" | "confidential">("internal");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("document");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 1) {
      setStatus("error");
      setMessage("Document title is required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = {
      title: title.trim(),
      category: category.trim() || undefined,
      accessLevel,
    };
    try {
      const res = await fetch("/api/proxy/v1/knowledge/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-KNOWLEDGE-DOCUMENTS-NEW-04: show saved-as-draft hint
      setStatus("success");
      setMessage("Document saved as draft.");
      router.push(backHref);
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-06: removed background:'#fff' — .field already uses var(--panel) */}
        <div className="field" style={{ gridColumn: "1 / -1", padding: "13px 16px" }}>
          <label className="label" htmlFor="title">Title *</label>
          <input id="title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. Travel Policy 2024" maxLength={200} />
        </div>
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-03: category <select> from shared constant list */}
        <div className="field" style={{ padding: "13px 16px" }}>
          <label className="label" htmlFor="category">Category</label>
          <select
            id="category"
            className="inp"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ minHeight: 44 }}
          >
            <option value="">Select a category</option>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-01: access level select, enforced server-side */}
        <div className="field" style={{ padding: "13px 16px" }}>
          <label className="label" htmlFor="accessLevel">Access level</label>
          <select
            id="accessLevel"
            className="inp"
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value as typeof accessLevel)}
            style={{ minHeight: 44 }}
          >
            <option value="public">Public</option>
            <option value="internal">Internal (default)</option>
            <option value="restricted">Restricted</option>
            <option value="confidential">Confidential</option>
          </select>
        </div>
      </div>

      {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-01: file attachment is not yet supported.
          Attaching a file requires object-storage (S3/MinIO) upload wiring and a
          fileKey field on the create command, which is a larger backend change.
          Until then, documents are created as metadata-only draft records and
          this is stated honestly rather than implying a file was stored. */}
      <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--mut, #667085)" }}>
        File attachments are not yet available here — this creates a draft document record. Access level is enforced on the server.
      </p>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-04: "Add document" (creates draft, not published) */}
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Add document"}
        </Button>
        <Link href={backHref} className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
