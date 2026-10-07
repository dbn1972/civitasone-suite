"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-KNOWLEDGE-POLICIES-01: author a governed draft document.
 *
 * POST /api/v1/knowledge/policies (createPolicyBody: title, docType, body,
 * referenceNo?, reviewDueDate?). The server creates the row in `draft` status
 * with the author = caller, and emits create + audit events.
 */
export function CreatePolicyForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<"sop" | "policy" | "circular">("sop");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("policy");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 1) {
      setStatus("error");
      setMessage("Title is required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/knowledge/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), docType, body }),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      const data = (await res.json().catch(() => null)) as { id?: string } | null;
      if (data?.id) {
        router.push(`/knowledge/policies/${data.id}`);
      } else {
        router.push("/knowledge/policies");
      }
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="title">Title *</label>
          <input id="title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. Travel &amp; Tour Policy 2026" />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="docType">Type</label>
          <select id="docType" className="inp" value={docType} onChange={(e) => setDocType(e.target.value as "sop" | "policy" | "circular")} style={{ minHeight: 44 }}>
            <option value="sop">SOP</option>
            <option value="policy">Policy</option>
            <option value="circular">Circular</option>
          </select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="body">Body</label>
          <textarea id="body" className="inp" value={body} onChange={(e) => setBody(e.target.value)} rows={10} style={{ minHeight: 180, resize: "vertical" }} placeholder="Document contents…" />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Create draft"}
        </Button>
        <Link href="/knowledge/policies" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
