"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoney } from "@/lib/formatters";

const TYPES = [
  { value: "open", label: "Open" },
  { value: "limited", label: "Limited" },
  { value: "single_source", label: "Single Source" },
  { value: "gem", label: "GeM" },
] as const;

export function CreateTenderForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("open");
  const [scope, setScope] = useState("");
  const [eligibility, setEligibility] = useState("");
  const [estimated, setEstimated] = useState(0);
  const [emd, setEmd] = useState(0);
  const [bidClosingDate, setBidClosingDate] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 1 || !bidClosingDate) {
      setStatus("error");
      setMessage("Title and bid closing date are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = {
      title: title.trim(),
      type,
      scope: scope.trim() || undefined,
      eligibility: eligibility.trim() || undefined,
      estimatedMinor: Math.max(0, Math.round(estimated * 100)),
      emdAmountMinor: Math.max(0, Math.round(emd * 100)),
      bidClosingDate,
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/tenders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Create failed (${res.status})`);
        return;
      }
      const parsed = JSON.parse(text) as { id?: string };
      setStatus("accepted");
      setMessage("Tender created and entered the workflow.");
      router.push(parsed.id ? `/procurement/tenders/${parsed.id}` : "/procurement/tenders");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 720 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="t-title">Tender title *</label>
          <input id="t-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} style={{ minHeight: 44 }}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Bid closing date *</span>
          <input type="date" value={bidClosingDate} onChange={(e) => setBidClosingDate(e.target.value)} required style={{ minHeight: 44 }} />
        </label>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="t-est">Estimated value (₹)</label>
          <input id="t-est" type="number" min={0} step="0.01" className="inp" value={estimated} onChange={(e) => setEstimated(Number(e.target.value))} style={{ minHeight: 44 }} />
          <span style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }} aria-live="polite">{formatMoney(Math.max(0, Math.round(estimated * 100)))}</span>
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="t-emd">EMD amount (₹)</label>
          <input id="t-emd" type="number" min={0} step="0.01" className="inp" value={emd} onChange={(e) => setEmd(Number(e.target.value))} style={{ minHeight: 44 }} />
          <span style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }} aria-live="polite">{formatMoney(Math.max(0, Math.round(emd * 100)))}</span>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="t-scope">Scope of work</label>
          <textarea id="t-scope" className="inp" rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="t-elig">Eligibility criteria</label>
          <textarea id="t-elig" className="inp" rows={3} value={eligibility} onChange={(e) => setEligibility(e.target.value)} />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Creating…" : "Create tender"}
        </button>
        <Link href="/procurement/tenders" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
