"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Seek Opinion" form.
 *
 * legal-service exposes no opinions create endpoint (opinions are read-only via
 * GET /api/v1/legal/opinions). Per the closest-existing-command rule this posts
 * to POST /api/v1/legal/notices, recording the opinion request as an outbound
 * legal notice. See the note banner on the page.
 */
export function SeekOpinionForm() {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [subject, setSubject] = useState("");
  const [addressedTo, setAddressedTo] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 3 || !addressedTo.trim()) {
      setStatus("error");
      setMessage("Opinion subject (min 3 chars) and addressee are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const ref = reference.trim() || `OPN/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 900) + 100)}`;
    const body = {
      noticeNo: ref,
      subject: subject.trim(),
      partyRef: addressedTo.trim(),
      direction: "sent" as const,
    };
    try {
      const res = await fetch("/api/proxy/v1/legal/notices", {
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
      router.push("/legal/opinions");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="reference">Reference no</label>
          <input id="reference" className="inp" value={reference} onChange={(e) => setReference(e.target.value)} style={{ minHeight: 44 }} placeholder="Auto-generated if blank" />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="addressedTo">Addressed to *</label>
          <input id="addressedTo" className="inp" value={addressedTo} onChange={(e) => setAddressedTo(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. Law Department / Sr. Counsel" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="subject">Opinion sought on *</label>
          <textarea id="subject" className="inp" rows={3} value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={256} placeholder="Describe the question on which an opinion is sought" />
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
          {status === "submitting" ? "Submitting…" : "Submit request"}
        </button>
        <Link href="/legal/opinions" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
