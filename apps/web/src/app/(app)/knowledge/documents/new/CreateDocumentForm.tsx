"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Publishes a document via POST /api/v1/knowledge/documents
 * (createDocumentBody: title, category?).
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
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

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
    };
    try {
      const res = await fetch("/api/proxy/v1/knowledge/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      router.push(backHref);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="title">Title *</label>
          <input id="title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. Travel Policy 2024" />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="category">Category</label>
          <input id="category" className="inp" value={category} onChange={(e) => setCategory(e.target.value)} style={{ minHeight: 44 }} placeholder="e.g. Circular, Policy, Notification" />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Publish document"}
        </button>
        <Link href={backHref} className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
