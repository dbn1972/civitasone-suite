'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

const AMENDMENT_TYPES = ["quantity", "price", "schedule", "scope", "change_order"] as const;

export default function POAmendPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [amendmentType, setAmendmentType] = useState<string>("scope");
  const [reason, setReason] = useState("");
  const [deltaMinor, setDeltaMinor] = useState<string>("0");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setStatus("error");
      setMessage("Reason must be at least 3 characters.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/procurement/pos/" + params.id + "/amendments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amendmentType,
          reason: reason.trim(),
          deltaMinor: Math.round(parseFloat(deltaMinor || "0") * 100),
          effectiveDate: effectiveDate || undefined,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || "Request failed");
        return;
      }
      setStatus("accepted");
      setMessage("Amendment submitted for approval.");
      setTimeout(() => router.push("/procurement/orders/" + params.id), 1200);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 20 }}>
        <button type="button" onClick={() => router.back()} className="btn" style={{ fontSize: 13 }}>
          ← Back to PO
        </button>
        <h1 style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>Request PO Amendment</h1>
        <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 4 }}>PO ID: <span className="mono" style={{ fontSize: 11 }}>{params.id}</span></p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="card pad" noValidate>
        <div className="fields">
          <div className="field">
            <label className="label" htmlFor="amendmentType">Amendment type *</label>
            <select id="amendmentType" className="inp" value={amendmentType} onChange={(e) => setAmendmentType(e.target.value)} style={{ minHeight: 44 }}>
              {AMENDMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\w/g, (c) => c.toUpperCase())}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="effectiveDate">Effective date</label>
            <input id="effectiveDate" type="date" className="inp" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} style={{ minHeight: 44 }} />
          </div>

          <div className="field">
            <label className="label" htmlFor="deltaMinor">Value change (INR, negative to reduce)</label>
            <input id="deltaMinor" type="number" className="inp" value={deltaMinor} onChange={(e) => setDeltaMinor(e.target.value)} step="0.01" style={{ minHeight: 44 }} />
          </div>

          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="label" htmlFor="reason">Reason for amendment *</label>
            <textarea id="reason" className="inp" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} required style={{ resize: "vertical" }} placeholder="Describe the amendment and business justification (min 3 chars)" />
          </div>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
              {message}
            </p>
          ) : null}
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
            {status === "submitting" ? "Submitting…" : "Submit amendment"}
          </button>
          <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
